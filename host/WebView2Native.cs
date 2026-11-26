using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace KuroDesk
{
    /// <summary>
    /// Reusable, zero-dependency COM host for Microsoft Edge WebView2 Runtime.
    /// Supports both transparent desktop pet surfaces (pet.html) and native dark Studio dashboards (studio.html),
    /// and maps both UI and user-imported local assets over virtual HTTPS origins.
    /// </summary>
    internal sealed class WebView2Host : IDisposable
    {
        private static readonly Guid IID_IUnknown = new Guid("00000000-0000-0000-C000-000000000046");
        private static readonly Guid IID_EnvCompleted = new Guid("4E8A3389-C9D8-4BD2-B6B5-124FEE6CC14D");
        private static readonly Guid IID_CtrlCompleted = new Guid("6C4819F3-C9B7-4260-8127-C9F5BDE7F68C");
        private static readonly Guid IID_WebMessageReceived = new Guid("57213F19-00E6-49FA-8E07-898EA01ECBD2");
        private static readonly Guid IID_Controller2 = new Guid("C979903E-D4CA-4228-92EB-47EE3FA96EAB");
        private static readonly Guid IID_CoreWebView2_3 = new Guid("A0D6DF20-3B92-416D-AA0C-437A9C727857");

        private static bool _envVarsConfigured = false;
        private static IntPtr _sharedDllModule = IntPtr.Zero;

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateEnvInternalDelegate(
            [MarshalAs(UnmanagedType.I1)] bool checkEdgeInstall,
            int runtimeType,
            [MarshalAs(UnmanagedType.LPWStr)] string userDataFolder,
            IntPtr envOptions,
            IntPtr handler);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int QueryInterfaceDelegate(IntPtr self, IntPtr riid, out IntPtr ppv);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint AddRefReleaseDelegate(IntPtr self);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int InvokeCompletedDelegate(IntPtr self, int errorCode, IntPtr objPtr);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int InvokeEventDelegate(IntPtr self, IntPtr sender, IntPtr args);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateControllerDelegate(IntPtr self, IntPtr parentHwnd, IntPtr handler);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int PutBoolDelegate(IntPtr self, int val);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int PutBoundsDelegate(IntPtr self, ref Win32Native.RECT bounds);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int NoArgDelegate(IntPtr self);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetPtrDelegate(IntPtr self, out IntPtr ptr);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int PutColorDelegate(IntPtr self, uint color);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int NavigateDelegate(IntPtr self, [MarshalAs(UnmanagedType.LPWStr)] string uri);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int PostMessageDelegate(IntPtr self, [MarshalAs(UnmanagedType.LPWStr)] string msg);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int AddEventHandlerDelegate(IntPtr self, IntPtr handler, out long token);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int RemoveEventHandlerDelegate(IntPtr self, long token);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int SetVirtualHostDelegate(
            IntPtr self,
            [MarshalAs(UnmanagedType.LPWStr)] string hostName,
            [MarshalAs(UnmanagedType.LPWStr)] string folderPath,
            int accessKind);

        private sealed class ComCallbackObject : IDisposable
        {
            public IntPtr ObjPtr;
            private IntPtr _vtblPtr;
            private readonly Guid _iid;
            private readonly List<Delegate> _pinned = new List<Delegate>();
            private int _refCount = 1;
            private int _ownerReleased = 0;
            private GCHandle _selfHandle;

            public ComCallbackObject(Guid iid, Delegate invokeDelegate)
            {
                _iid = iid;
                _selfHandle = GCHandle.Alloc(this);
                QueryInterfaceDelegate qi = QueryInterface;
                AddRefReleaseDelegate addRef = AddRef;
                AddRefReleaseDelegate release = Release;

                _pinned.Add(qi);
                _pinned.Add(addRef);
                _pinned.Add(release);
                _pinned.Add(invokeDelegate);

                _vtblPtr = Marshal.AllocHGlobal(IntPtr.Size * 4);
                Marshal.WriteIntPtr(_vtblPtr, 0 * IntPtr.Size, Marshal.GetFunctionPointerForDelegate(qi));
                Marshal.WriteIntPtr(_vtblPtr, 1 * IntPtr.Size, Marshal.GetFunctionPointerForDelegate(addRef));
                Marshal.WriteIntPtr(_vtblPtr, 2 * IntPtr.Size, Marshal.GetFunctionPointerForDelegate(release));
                Marshal.WriteIntPtr(_vtblPtr, 3 * IntPtr.Size, Marshal.GetFunctionPointerForDelegate(invokeDelegate));

                ObjPtr = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(ObjPtr, 0, _vtblPtr);
            }

            private int QueryInterface(IntPtr self, IntPtr riidPtr, out IntPtr ppv)
            {
                Guid riid = (Guid)Marshal.PtrToStructure(riidPtr, typeof(Guid));
                if (riid == IID_IUnknown || riid == _iid)
                {
                    AddRef(self);
                    ppv = self;
                    return 0;
                }
                ppv = IntPtr.Zero;
                return unchecked((int)0x80004002);
            }

            private uint AddRef(IntPtr self)
            {
                return (uint)System.Threading.Interlocked.Increment(ref _refCount);
            }

            private uint Release(IntPtr self)
            {
                int rem = System.Threading.Interlocked.Decrement(ref _refCount);
                if (rem <= 0)
                {
                    FreeNative();
                    return 0;
                }
                return (uint)rem;
            }

            private void FreeNative()
            {
                IntPtr obj = System.Threading.Interlocked.Exchange(ref ObjPtr, IntPtr.Zero);
                if (obj != IntPtr.Zero) Marshal.FreeHGlobal(obj);
                IntPtr vt = System.Threading.Interlocked.Exchange(ref _vtblPtr, IntPtr.Zero);
                if (vt != IntPtr.Zero) Marshal.FreeHGlobal(vt);
                _pinned.Clear();
                if (_selfHandle.IsAllocated) _selfHandle.Free();
            }

            public void Dispose()
            {
                if (System.Threading.Interlocked.Exchange(ref _ownerReleased, 1) == 0)
                {
                    Release(IntPtr.Zero);
                }
            }
        }

        private IntPtr _hwnd;
        private string _uiFolder;
        private string _assetsFolder;
        private string _entryPage;
        private bool _transparent;
        private bool _enableDevTools;
        private uint _opaqueBgRgba;

        private IntPtr _env = IntPtr.Zero;
        private IntPtr _controller = IntPtr.Zero;
        private IntPtr _webview = IntPtr.Zero;
        private long _msgToken = 0;

        // Cached hot-path COM vtable delegates to avoid per-frame interop allocation
        private PostMessageDelegate _postMessageFn;
        private PutBoundsDelegate _putBoundsFn;
        private NoArgDelegate _notifyMovedFn;

        private ComCallbackObject _envHandler;
        private ComCallbackObject _ctrlHandler;
        private ComCallbackObject _msgHandler;
        private bool _ready;
        private bool _disposed;

        public event Action OnReady;
        public event Action<string> OnWebMessage;
        public event Action<string> OnError;

        public bool IsReady { get { return _ready; } }

        public void Initialize(
            IntPtr parentHwnd,
            string uiFolder,
            string assetsFolder,
            string userDataFolder,
            string entryPage,
            bool transparent,
            uint opaqueBgRgba,
            bool enableDevTools)
        {
            _hwnd = parentHwnd;
            _uiFolder = uiFolder;
            _assetsFolder = assetsFolder;
            _entryPage = entryPage;
            _transparent = transparent;
            _opaqueBgRgba = opaqueBgRgba;
            _enableDevTools = enableDevTools;

            Directory.CreateDirectory(userDataFolder);
            Directory.CreateDirectory(_assetsFolder);

            if (!_envVarsConfigured)
            {
                _envVarsConfigured = true;
                Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
                Environment.SetEnvironmentVariable(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
            }

            if (_sharedDllModule == IntPtr.Zero)
            {
                string dllPath = FindEmbeddedBrowserDll();
                if (string.IsNullOrEmpty(dllPath) || !File.Exists(dllPath))
                {
                    RaiseError("未检测到系统 Edge WebView2 运行时。");
                    return;
                }
                _sharedDllModule = Win32Native.LoadLibrary(dllPath);
                if (_sharedDllModule == IntPtr.Zero)
                {
                    RaiseError("无法加载 EmbeddedBrowserWebView.dll: " + dllPath);
                    return;
                }
            }

            IntPtr fnPtr = Win32Native.GetProcAddress(_sharedDllModule, "CreateWebViewEnvironmentWithOptionsInternal");
            if (fnPtr == IntPtr.Zero)
            {
                RaiseError("WebView2 导出函数缺失。");
                return;
            }

            CreateEnvInternalDelegate createEnv = (CreateEnvInternalDelegate)
                Marshal.GetDelegateForFunctionPointer(fnPtr, typeof(CreateEnvInternalDelegate));

            _envHandler = new ComCallbackObject(IID_EnvCompleted, new InvokeCompletedDelegate(OnEnvironmentCreated));
            int hr = createEnv(true, 0, userDataFolder, IntPtr.Zero, _envHandler.ObjPtr);
            if (hr < 0)
            {
                RaiseError(string.Format("CreateWebViewEnvironment failed: 0x{0:X8}", hr));
            }
        }

        private int OnEnvironmentCreated(IntPtr self, int hr, IntPtr envPtr)
        {
            if (_disposed) return 0;
            if (hr < 0 || envPtr == IntPtr.Zero)
            {
                RaiseError(string.Format("Environment callback failed: 0x{0:X8}", hr));
                return 0;
            }
            _env = envPtr;
            ComAddRef(_env);

            _ctrlHandler = new ComCallbackObject(IID_CtrlCompleted, new InvokeCompletedDelegate(OnControllerCreated));
            int cHr = GetVtblDelegate<CreateControllerDelegate>(_env, 3)(_env, _hwnd, _ctrlHandler.ObjPtr);
            if (cHr < 0)
            {
                RaiseError(string.Format("CreateCoreWebView2Controller failed: 0x{0:X8}", cHr));
            }
            return 0;
        }

        private int OnControllerCreated(IntPtr self, int hr, IntPtr controllerPtr)
        {
            if (_disposed)
            {
                if (controllerPtr != IntPtr.Zero)
                {
                    try { GetVtblDelegate<NoArgDelegate>(controllerPtr, 24)(controllerPtr); } catch { }
                }
                return 0;
            }
            if (hr < 0 || controllerPtr == IntPtr.Zero)
            {
                RaiseError(string.Format("Controller callback failed: 0x{0:X8}", hr));
                return 0;
            }

            _controller = controllerPtr;
            ComAddRef(_controller);
            _putBoundsFn = GetVtblDelegate<PutBoundsDelegate>(_controller, 6);
            _notifyMovedFn = GetVtblDelegate<NoArgDelegate>(_controller, 23);

            IntPtr ctrl2 = ComQueryInterface(_controller, IID_Controller2);
            if (ctrl2 != IntPtr.Zero)
            {
                try
                {
                    GetVtblDelegate<PutColorDelegate>(ctrl2, 27)(ctrl2, _transparent ? 0x00000000u : _opaqueBgRgba);
                }
                finally
                {
                    ComRelease(ctrl2);
                }
            }

            // get_CoreWebView2 returns an already-AddRef'd pointer (no extra ComAddRef needed)
            GetVtblDelegate<GetPtrDelegate>(_controller, 25)(_controller, out _webview);
            if (_webview == IntPtr.Zero)
            {
                RaiseError("Failed to obtain ICoreWebView2.");
                return 0;
            }
            _postMessageFn = GetVtblDelegate<PostMessageDelegate>(_webview, 32);

            IntPtr settingsPtr;
            if (GetVtblDelegate<GetPtrDelegate>(_webview, 3)(_webview, out settingsPtr) == 0 && settingsPtr != IntPtr.Zero)
            {
                try
                {
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 4)(settingsPtr, 1);  // Script
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 6)(settingsPtr, 1);  // WebMessage
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 8)(settingsPtr, 0);  // ScriptDialogs
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 10)(settingsPtr, 0); // StatusBar
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 12)(settingsPtr, _enableDevTools ? 1 : 0);
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 14)(settingsPtr, 0); // ContextMenus
                    GetVtblDelegate<PutBoolDelegate>(settingsPtr, 18)(settingsPtr, 0); // ZoomControl
                }
                finally
                {
                    ComRelease(settingsPtr);
                }
            }

            _msgHandler = new ComCallbackObject(IID_WebMessageReceived, new InvokeEventDelegate(OnWebMessageReceived));
            GetVtblDelegate<AddEventHandlerDelegate>(_webview, 34)(_webview, _msgHandler.ObjPtr, out _msgToken);

            string targetUrl = null;
            IntPtr wv3 = ComQueryInterface(_webview, IID_CoreWebView2_3);
            if (wv3 != IntPtr.Zero)
            {
                try
                {
                    SetVirtualHostDelegate mapHost = GetVtblDelegate<SetVirtualHostDelegate>(wv3, 71);
                    if (mapHost(wv3, "kuro.local", _uiFolder, 1) == 0)
                    {
                        targetUrl = "https://kuro.local/" + _entryPage;
                    }
                    // Map user-imported assets directory to https://kuro-assets.local/
                    mapHost(wv3, "kuro-assets.local", _assetsFolder, 1);
                }
                finally
                {
                    ComRelease(wv3);
                }
            }
            if (targetUrl == null)
            {
                targetUrl = new Uri(Path.Combine(_uiFolder, _entryPage)).AbsoluteUri;
            }

            ResizeToClient();
            GetVtblDelegate<PutBoolDelegate>(_controller, 4)(_controller, 1);
            GetVtblDelegate<NavigateDelegate>(_webview, 5)(_webview, targetUrl);

            _ready = true;
            Action readyHandler = OnReady;
            if (readyHandler != null) readyHandler();
            return 0;
        }

        private int OnWebMessageReceived(IntPtr self, IntPtr sender, IntPtr args)
        {
            if (_disposed || args == IntPtr.Zero) return 0;
            IntPtr strPtr;
            int hr = GetVtblDelegate<GetPtrDelegate>(args, 5)(args, out strPtr);
            if (hr == 0 && strPtr != IntPtr.Zero)
            {
                try
                {
                    string msg = Marshal.PtrToStringUni(strPtr);
                    Action<string> handler = OnWebMessage;
                    if (handler != null && msg != null) handler(msg);
                }
                finally
                {
                    Win32Native.CoTaskMemFree(strPtr);
                }
            }
            return 0;
        }

        public void ResizeToClient()
        {
            if (_controller == IntPtr.Zero || _hwnd == IntPtr.Zero) return;
            Win32Native.RECT rc;
            if (!Win32Native.GetClientRect(_hwnd, out rc)) return;
            Win32Native.RECT bounds = new Win32Native.RECT();
            bounds.Left = 0;
            bounds.Top = 0;
            bounds.Right = Math.Max(1, rc.Right - rc.Left);
            bounds.Bottom = Math.Max(1, rc.Bottom - rc.Top);
            if (_putBoundsFn != null) _putBoundsFn(_controller, ref bounds);
        }

        public void ResizeToBounds(int w, int h)
        {
            if (_controller == IntPtr.Zero || _putBoundsFn == null) return;
            Win32Native.RECT bounds = new Win32Native.RECT();
            bounds.Left = 0;
            bounds.Top = 0;
            bounds.Right = Math.Max(1, w);
            bounds.Bottom = Math.Max(1, h);
            _putBoundsFn(_controller, ref bounds);
        }

        public void NotifyMoved()
        {
            if (_controller == IntPtr.Zero || _notifyMovedFn == null) return;
            _notifyMovedFn(_controller);
        }

        public void PostJson(string json)
        {
            if (!_ready || _disposed || _webview == IntPtr.Zero || _postMessageFn == null || string.IsNullOrEmpty(json)) return;
            _postMessageFn(_webview, json);
        }

        private void RaiseError(string message)
        {
            Action<string> err = OnError;
            if (err != null) err(message);
        }

        private static T GetVtblDelegate<T>(IntPtr comObj, int slot) where T : class
        {
            IntPtr vtbl = Marshal.ReadIntPtr(comObj);
            IntPtr fnPtr = Marshal.ReadIntPtr(vtbl, slot * IntPtr.Size);
            return Marshal.GetDelegateForFunctionPointer(fnPtr, typeof(T)) as T;
        }

        private static IntPtr ComQueryInterface(IntPtr comObj, Guid iid)
        {
            IntPtr iidMem = Marshal.AllocHGlobal(16);
            try
            {
                Marshal.StructureToPtr(iid, iidMem, false);
                IntPtr result;
                int hr = GetVtblDelegate<QueryInterfaceDelegate>(comObj, 0)(comObj, iidMem, out result);
                return hr == 0 ? result : IntPtr.Zero;
            }
            finally
            {
                Marshal.FreeHGlobal(iidMem);
            }
        }

        private static void ComAddRef(IntPtr comObj)
        {
            if (comObj != IntPtr.Zero) GetVtblDelegate<AddRefReleaseDelegate>(comObj, 1)(comObj);
        }

        private static void ComRelease(IntPtr comObj)
        {
            if (comObj != IntPtr.Zero) GetVtblDelegate<AddRefReleaseDelegate>(comObj, 2)(comObj);
        }

        private static string FindEmbeddedBrowserDll()
        {
            string arch = IntPtr.Size == 8 ? "x64" : "x86";
            string relDll = Path.Combine("EBWebView", arch, "EmbeddedBrowserWebView.dll");
            string guid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

            string[] statePaths = {
                @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\" + guid,
                @"SOFTWARE\Microsoft\EdgeUpdate\ClientState\" + guid
            };
            RegistryKey[] roots = { Registry.LocalMachine, Registry.CurrentUser };
            foreach (RegistryKey root in roots)
            {
                foreach (string sub in statePaths)
                {
                    try
                    {
                        using (RegistryKey key = root.OpenSubKey(sub))
                        {
                            if (key != null)
                            {
                                string eb = key.GetValue("EBWebView") as string;
                                if (!string.IsNullOrEmpty(eb))
                                {
                                    string cand = Path.Combine(eb, relDll);
                                    if (File.Exists(cand)) return cand;
                                }
                            }
                        }
                    }
                    catch { }
                }
            }

            string[] clientPaths = {
                @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\" + guid,
                @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" + guid
            };
            foreach (RegistryKey root in roots)
            {
                foreach (string sub in clientPaths)
                {
                    try
                    {
                        using (RegistryKey key = root.OpenSubKey(sub))
                        {
                            if (key != null)
                            {
                                string loc = key.GetValue("location") as string;
                                string pv = key.GetValue("pv") as string;
                                if (!string.IsNullOrEmpty(loc) && !string.IsNullOrEmpty(pv))
                                {
                                    string cand = Path.Combine(loc, pv, relDll);
                                    if (File.Exists(cand)) return cand;
                                }
                            }
                        }
                    }
                    catch { }
                }
            }

            string[] baseDirs = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\EdgeWebView\Application"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\EdgeWebView\Application")
            };
            foreach (string baseDir in baseDirs)
            {
                if (!Directory.Exists(baseDir)) continue;
                string[] dirs = Directory.GetDirectories(baseDir);
                Array.Sort(dirs);
                for (int i = dirs.Length - 1; i >= 0; i--)
                {
                    string cand = Path.Combine(dirs[i], relDll);
                    if (File.Exists(cand)) return cand;
                }
            }
            return null;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _ready = false;
            _postMessageFn = null;
            _putBoundsFn = null;
            _notifyMovedFn = null;

            if (_webview != IntPtr.Zero && _msgToken != 0)
            {
                try { GetVtblDelegate<RemoveEventHandlerDelegate>(_webview, 35)(_webview, _msgToken); } catch { }
                _msgToken = 0;
            }
            if (_controller != IntPtr.Zero)
            {
                try { GetVtblDelegate<NoArgDelegate>(_controller, 24)(_controller); } catch { }
                ComRelease(_controller);
                _controller = IntPtr.Zero;
            }
            if (_webview != IntPtr.Zero) { ComRelease(_webview); _webview = IntPtr.Zero; }
            if (_env != IntPtr.Zero) { ComRelease(_env); _env = IntPtr.Zero; }
            if (_msgHandler != null) { _msgHandler.Dispose(); _msgHandler = null; }
            if (_ctrlHandler != null) { _ctrlHandler.Dispose(); _ctrlHandler = null; }
            if (_envHandler != null) { _envHandler.Dispose(); _envHandler = null; }
        }
    }
}
