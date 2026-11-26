using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace KuroDesk
{
    /// <summary>
    /// Zero-dependency Windows Core Audio WASAPI Loopback monitor.
    /// Captures system playback audio (no microphone needed) and computes smooth energy, bass,
    /// and beat pulse values for real-time character music head-bob and desk LED reactivity.
    /// </summary>
    internal sealed class WasapiAudioMonitor : IDisposable
    {
        private static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
        private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
        private static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00AA00389B71");

        private const uint CLSCTX_ALL = 23;
        private const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        private const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid id, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
            [PreserveSig] int OpenPropertyStore(uint stgmAccess, out IntPtr properties);
            [PreserveSig] int GetId(out IntPtr ppstrId);
            [PreserveSig] int GetState(out uint pdwState);
        }

        [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioClient
        {
            [PreserveSig] int Initialize(int shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, ref Guid audioSessionGuid);
            [PreserveSig] int GetBufferSize(out uint bufferSize);
            [PreserveSig] int GetStreamLatency(out long latency);
            [PreserveSig] int GetCurrentPadding(out int padding);
            [PreserveSig] int IsFormatSupported(int shareMode, IntPtr pFormat, out IntPtr closestMatch);
            [PreserveSig] int GetMixFormat(out IntPtr deviceFormatPointer);
            [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
            [PreserveSig] int Start();
            [PreserveSig] int Stop();
            [PreserveSig] int Reset();
            [PreserveSig] int SetEventHandle(IntPtr eventHandle);
            [PreserveSig] int GetService(ref Guid interfaceId, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
        }

        [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioCaptureClient
        {
            [PreserveSig] int GetBuffer(out IntPtr dataBuffer, out uint numFramesToRead, out uint bufferFlags, out ulong devicePosition, out ulong qpcPosition);
            [PreserveSig] int ReleaseBuffer(uint numFramesRead);
            [PreserveSig] int GetNextPacketSize(out uint numFramesInNextPacket);
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WAVEFORMATEX
        {
            public ushort wFormatTag;
            public ushort nChannels;
            public uint nSamplesPerSec;
            public uint nAvgBytesPerSec;
            public ushort nBlockAlign;
            public ushort wBitsPerSample;
            public ushort cbSize;
        }

        private Thread _thread;
        private readonly ManualResetEventSlim _stopEvent = new ManualResetEventSlim(false);
        private volatile bool _running;
        private volatile bool _enabled = true;

        // Thread-safe smoothed telemetry read by UI timer
        private volatile float _level;
        private volatile float _bass;
        private volatile float _beat;
        private volatile bool _isPlaying;

        public bool Enabled
        {
            get { return _enabled; }
            set { _enabled = value; }
        }

        public float Level { get { return _level; } }
        public float Bass { get { return _bass; } }
        public float Beat { get { return _beat; } }
        public bool IsPlaying { get { return _isPlaying; } }

        public void Start()
        {
            if (_running) return;
            _running = true;
            _stopEvent.Reset();
            _thread = new Thread(CaptureLoop);
            _thread.IsBackground = true;
            _thread.Name = "KuroDesk-WASAPI";
            _thread.SetApartmentState(ApartmentState.MTA);
            _thread.Start();
        }

        private bool SleepInterruptible(int ms)
        {
            return _stopEvent.Wait(ms);
        }

        private static string GetDeviceIdSafe(IMMDevice dev)
        {
            if (dev == null) return "";
            IntPtr pId;
            if (dev.GetId(out pId) == 0 && pId != IntPtr.Zero)
            {
                try { return Marshal.PtrToStringUni(pId) ?? ""; }
                finally { Win32Native.CoTaskMemFree(pId); }
            }
            return "";
        }

        private static bool IsFormatIeeeFloat(IntPtr mixFmtPtr, WAVEFORMATEX fmt)
        {
            if (fmt.wFormatTag == 3) return true; // WAVE_FORMAT_IEEE_FLOAT
            if (fmt.wFormatTag == 0xFFFE && fmt.cbSize >= 22) // WAVE_FORMAT_EXTENSIBLE
            {
                byte[] guidBytes = new byte[16];
                Marshal.Copy(new IntPtr(mixFmtPtr.ToInt64() + 24), guidBytes, 0, 16);
                return new Guid(guidBytes) == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
            }
            return false;
        }

        private void CaptureLoop()
        {
            while (_running)
            {
                if (!_enabled)
                {
                    _level = 0f; _bass = 0f; _beat = 0f; _isPlaying = false;
                    if (SleepInterruptible(200)) break;
                    continue;
                }

                IMMDeviceEnumerator enumerator = null;
                IMMDevice device = null;
                IAudioClient audioClient = null;
                IAudioCaptureClient capture = null;
                IntPtr mixFmtPtr = IntPtr.Zero;

                try
                {
                    Type enumType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
                    if (enumType == null) { if (SleepInterruptible(2000)) break; continue; }
                    enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumType);
                    if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null)
                    {
                        if (SleepInterruptible(1500)) break;
                        continue;
                    }
                    string activeDeviceId = GetDeviceIdSafe(device);

                    Guid iidClient = IID_IAudioClient;
                    object clientObj;
                    if (device.Activate(ref iidClient, CLSCTX_ALL, IntPtr.Zero, out clientObj) != 0)
                    {
                        if (SleepInterruptible(1500)) break;
                        continue;
                    }
                    audioClient = (IAudioClient)clientObj;

                    if (audioClient.GetMixFormat(out mixFmtPtr) != 0 || mixFmtPtr == IntPtr.Zero)
                    {
                        if (SleepInterruptible(1500)) break;
                        continue;
                    }

                    WAVEFORMATEX fmt = (WAVEFORMATEX)Marshal.PtrToStructure(mixFmtPtr, typeof(WAVEFORMATEX));
                    int channels = Math.Max(1, (int)fmt.nChannels);
                    int bits = fmt.wBitsPerSample;
                    bool isFloat = IsFormatIeeeFloat(mixFmtPtr, fmt);

                    // Compute sample-rate-accurate 160Hz 1-pole lowpass coefficient
                    float sr = Math.Max(8000f, (float)fmt.nSamplesPerSec);
                    float dt = 1f / sr;
                    float rc = 1f / (2f * (float)Math.PI * 160f);
                    float lpAlpha = dt / (rc + dt);

                    Guid sessionGuid = Guid.Empty;
                    long bufferDur = 1000000; // 100ms in 100ns units
                    int hrInit = audioClient.Initialize(0, AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDur, 0, mixFmtPtr, ref sessionGuid);
                    if (hrInit != 0)
                    {
                        if (SleepInterruptible(2000)) break;
                        continue;
                    }

                    Guid iidCap = IID_IAudioCaptureClient;
                    object capObj;
                    if (audioClient.GetService(ref iidCap, out capObj) != 0)
                    {
                        if (SleepInterruptible(1500)) break;
                        continue;
                    }
                    capture = (IAudioCaptureClient)capObj;

                    if (audioClient.Start() != 0)
                    {
                        if (SleepInterruptible(1500)) break;
                        continue;
                    }

                    float lpState = 0f;
                    float avgBass = 0.02f;
                    float smoothLvl = 0f;
                    float smoothBass = 0f;
                    float beatEnv = 0f;
                    int silentTicks = 0;
                    int deviceCheckCounter = 0;

                    float[] fBuf = new float[8192];
                    int[] iBuf = new int[8192];
                    short[] sBuf = new short[8192];
                    byte[] bBuf = new byte[8192 * 3];

                    while (_running && _enabled)
                    {
                        // Detect hot-swapped default audio output device (headphones/Bluetooth/DAC) every ~2.5s
                        deviceCheckCounter++;
                        if (deviceCheckCounter >= 100)
                        {
                            deviceCheckCounter = 0;
                            IMMDevice probe = null;
                            try
                            {
                                if (enumerator.GetDefaultAudioEndpoint(0, 1, out probe) == 0 && probe != null)
                                {
                                    string curId = GetDeviceIdSafe(probe);
                                    if (!string.IsNullOrEmpty(curId) && curId != activeDeviceId)
                                    {
                                        break; // Re-initialize loopback on the new default render device!
                                    }
                                }
                            }
                            finally
                            {
                                if (probe != null) Marshal.ReleaseComObject(probe);
                            }
                        }

                        uint packetLen;
                        if (capture.GetNextPacketSize(out packetLen) != 0) break;

                        bool gotSignal = false;
                        while (packetLen > 0)
                        {
                            IntPtr dataPtr;
                            uint frames;
                            uint flags;
                            ulong devPos, qpcPos;
                            if (capture.GetBuffer(out dataPtr, out frames, out flags, out devPos, out qpcPos) != 0)
                                break;

                            try
                            {
                                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && frames > 0 && dataPtr != IntPtr.Zero)
                                {
                                    int sampleCount = (int)Math.Min(frames * channels, 8192u);
                                    double sumSq = 0;
                                    double bassSq = 0;
                                    int monoN = sampleCount / channels;

                                    if (isFloat && bits == 32)
                                    {
                                        Marshal.Copy(dataPtr, fBuf, 0, sampleCount);
                                        for (int i = 0; i < monoN; i++)
                                        {
                                            float s = fBuf[i * channels];
                                            if (channels > 1) s = (s + fBuf[i * channels + 1]) * 0.5f;
                                            if (float.IsNaN(s) || float.IsInfinity(s)) continue;
                                            if (s > 1f) s = 1f; else if (s < -1f) s = -1f;
                                            sumSq += s * s;
                                            lpState += (s - lpState) * lpAlpha;
                                            bassSq += lpState * lpState;
                                        }
                                    }
                                    else if (!isFloat && bits == 32)
                                    {
                                        Marshal.Copy(dataPtr, iBuf, 0, sampleCount);
                                        for (int i = 0; i < monoN; i++)
                                        {
                                            float s = iBuf[i * channels] / 2147483648f;
                                            if (channels > 1) s = (s + iBuf[i * channels + 1] / 2147483648f) * 0.5f;
                                            sumSq += s * s;
                                            lpState += (s - lpState) * lpAlpha;
                                            bassSq += lpState * lpState;
                                        }
                                    }
                                    else if (bits == 24)
                                    {
                                        int byteLen = sampleCount * 3;
                                        Marshal.Copy(dataPtr, bBuf, 0, byteLen);
                                        for (int i = 0; i < monoN; i++)
                                        {
                                            int o0 = (i * channels) * 3;
                                            int v0 = bBuf[o0] | (bBuf[o0 + 1] << 8) | ((sbyte)bBuf[o0 + 2] << 16);
                                            float s = v0 / 8388608f;
                                            if (channels > 1)
                                            {
                                                int o1 = o0 + 3;
                                                int v1 = bBuf[o1] | (bBuf[o1 + 1] << 8) | ((sbyte)bBuf[o1 + 2] << 16);
                                                s = (s + v1 / 8388608f) * 0.5f;
                                            }
                                            sumSq += s * s;
                                            lpState += (s - lpState) * lpAlpha;
                                            bassSq += lpState * lpState;
                                        }
                                    }
                                    else if (bits == 16)
                                    {
                                        Marshal.Copy(dataPtr, sBuf, 0, sampleCount);
                                        for (int i = 0; i < monoN; i++)
                                        {
                                            float s = sBuf[i * channels] / 32768f;
                                            if (channels > 1) s = (s + sBuf[i * channels + 1] / 32768f) * 0.5f;
                                            sumSq += s * s;
                                            lpState += (s - lpState) * lpAlpha;
                                            bassSq += lpState * lpState;
                                        }
                                    }

                                    if (monoN > 0)
                                    {
                                        float rms = (float)Math.Sqrt(sumSq / monoN);
                                        float bassRms = (float)Math.Sqrt(bassSq / monoN);
                                        float normLvl = Math.Min(1f, rms * 4.2f);
                                        float normBass = Math.Min(1f, bassRms * 6.5f);

                                        smoothLvl = smoothLvl * 0.65f + normLvl * 0.35f;
                                        smoothBass = smoothBass * 0.60f + normBass * 0.40f;
                                        avgBass = avgBass * 0.94f + normBass * 0.06f;

                                        if (normBass > 0.14f && normBass > avgBass * 1.38f)
                                        {
                                            beatEnv = Math.Min(1f, beatEnv + 0.65f);
                                        }
                                        if (normLvl > 0.025f) gotSignal = true;
                                    }
                                }
                            }
                            finally
                            {
                                capture.ReleaseBuffer(frames);
                            }

                            if (capture.GetNextPacketSize(out packetLen) != 0) break;
                        }

                        if (!gotSignal)
                        {
                            smoothLvl *= 0.84f;
                            smoothBass *= 0.84f;
                            silentTicks++;
                        }
                        else
                        {
                            silentTicks = 0;
                        }
                        beatEnv *= 0.78f;

                        _level = smoothLvl;
                        _bass = smoothBass;
                        _beat = beatEnv;
                        _isPlaying = (silentTicks < 35 && smoothLvl > 0.018f);

                        if (SleepInterruptible(24)) break;
                    }

                    try { audioClient.Stop(); } catch { }
                }
                catch
                {
                    if (SleepInterruptible(1500)) break;
                }
                finally
                {
                    if (mixFmtPtr != IntPtr.Zero) Win32Native.CoTaskMemFree(mixFmtPtr);
                    if (capture != null) Marshal.ReleaseComObject(capture);
                    if (audioClient != null) Marshal.ReleaseComObject(audioClient);
                    if (device != null) Marshal.ReleaseComObject(device);
                    if (enumerator != null) Marshal.ReleaseComObject(enumerator);
                }
            }
        }

        public void Dispose()
        {
            _running = false;
            _stopEvent.Set();
            if (_thread != null && _thread.IsAlive)
            {
                try { _thread.Join(500); } catch { }
            }
            _stopEvent.Dispose();
        }
    }
}
