using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Windows.Forms;

namespace KuroDesk
{
    /// <summary>
    /// Central application coordinator.
    /// Connects OS Sensors (GlobalInputHook, WasapiAudioMonitor, SystemContextMonitor),
    /// ConfigStore, AssetManager, PetWindow (zero-HUD desktop overlay), StudioWindow (C-end config dashboard),
    /// and the Windows System Tray.
    /// </summary>
    internal sealed class AppCoordinator : ApplicationContext
    {
        private readonly ConfigStore _store;
        private readonly AssetManager _assets;
        private readonly GlobalInputHook _hook;
        private readonly WasapiAudioMonitor _audio;
        private readonly SystemContextMonitor _context;

        private readonly PetWindow _petWindow;
        private readonly StudioWindow _studioWindow;
        private readonly NotifyIcon _tray;
        private readonly Icon _appIcon;

        private readonly Timer _frameTimer;
        private readonly Timer _contextTimer;
        private readonly Timer _saveTimer;

        private readonly bool _smokeTest;
        private bool _smokePetReady;
        private bool _smokeStudioReady;

        // Latest sensor cache
        private volatile int _cursorX = -9999;
        private volatile int _cursorY = -9999;
        private volatile bool _cursorDirty = false;
        private SystemSnapshot _lastSnapshot = new SystemSnapshot();
        private string _lastSentContextCat = "";
        private string _lastSentProc = "";
        private bool _lastSentNight = false;
        private int _lastSentAmbR = -1, _lastSentAmbG = -1, _lastSentAmbB = -1;
        private bool _wasAudioActive = false;
        private int _audioPushDivider = 0;

        // Debounced config persistence (avoids disk thrashing during slider drags)
        private bool _configDirty = false;
        private DateTime _lastPatchUtc = DateTime.MinValue;

        // Tray menu check items
        private ToolStripMenuItem _miClickThrough;
        private ToolStripMenuItem _miPeekMode;

        public AppCoordinator(string uiFolder, bool debugMode, bool openStudioOnStart, bool smokeTest)
        {
            _smokeTest = smokeTest;
            _store = new ConfigStore();
            _assets = new AssetManager(_store);
            _context = new SystemContextMonitor();
            _appIcon = CreateBrandTrayIcon();

            _petWindow = new PetWindow(uiFolder, _store, debugMode, smokeTest);
            _studioWindow = new StudioWindow(uiFolder, _store, _assets, _appIcon, debugMode, smokeTest);

            WireWindowEvents();
            _tray = BuildTrayIcon();

            if (!smokeTest)
            {
                _hook = new GlobalInputHook();
                _hook.OnKeySlotEvent += OnGlobalKey;
                _hook.OnShortcutMeme += OnGlobalShortcutMeme;
                _hook.OnMouseMove += OnGlobalMouseMove;
                _hook.OnMouseButton += OnGlobalMouseButton;
                _hook.OnMouseWheel += OnGlobalMouseWheel;
                _hook.Start();

                _audio = new WasapiAudioMonitor();
                _audio.Enabled = _store.Current.audioReactive;
                _audio.Start();
            }

            _frameTimer = new Timer();
            _frameTimer.Interval = 16; // ~60Hz hook drain, eye tracking, window-peek glide & audio pulse
            _frameTimer.Tick += OnFrameTick;
            _frameTimer.Start();

            _contextTimer = new Timer();
            _contextTimer.Interval = 220; // ~4.5Hz foreground app & deferred save flush
            _contextTimer.Tick += OnContextTick;
            _contextTimer.Start();

            _saveTimer = new Timer();
            _saveTimer.Interval = 15000;
            _saveTimer.Tick += delegate { if (!_smokeTest) FlushPendingSave(true); };
            _saveTimer.Start();

            _petWindow.Show();

            bool firstRunOpen = false;
            if (!smokeTest && !_store.Current.firstRunDone)
            {
                _store.Current.firstRunDone = true;
                _store.Save();
                firstRunOpen = true;
            }

            if (openStudioOnStart || smokeTest || firstRunOpen)
            {
                OpenStudio();
            }
        }

        private void OpenStudio()
        {
            _studioWindow.ShowStudio();
            _studioWindow.PushHotkeyStatus(_petWindow.HotkeyStatus);
            PushCurrentContext(true);
        }

        private void WireWindowEvents()
        {
            _petWindow.OnUiReady += delegate
            {
                _smokePetReady = true;
                PushCurrentContext(true);
                CheckSmokeComplete();
            };
            _petWindow.OnHotkeyPressed += HandleHotkey;
            _petWindow.OnScaleDeltaRequested += delegate(double dv)
            {
                ApplyPatch(new Dictionary<string, object> { { "scale", _store.Current.scale + dv } }, false);
            };
            _petWindow.OnOpenStudioRequested += delegate { OpenStudio(); };
            _petWindow.FormClosed += delegate { Shutdown(); };

            _studioWindow.OnStudioReady += delegate
            {
                _smokeStudioReady = true;
                _studioWindow.PushHotkeyStatus(_petWindow.HotkeyStatus);
                PushCurrentContext(true);
                if (_smokeTest) Console.WriteLine("SMOKE_STUDIO_UI_READY");
                CheckSmokeComplete();
            };
            _studioWindow.OnConfigPatch += ApplyPatch;
            _studioWindow.OnResetPositionRequested += delegate
            {
                _petWindow.ResetDeskPosition();
                _studioWindow.PushConfig();
                SyncTrayMenu();
            };
            _studioWindow.OnPreviewActionRequested += delegate(string action)
            {
                string msg = "{\"t\":\"demo\",\"a\":\"" + EscapeJson(action) + "\"}";
                _petWindow.PostMessage(msg);
            };
            _studioWindow.OnModelTriggerRequested += delegate(string type, string name, int index)
            {
                string msg = string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"t\":\"mcmd\",\"k\":\"{0}\",\"n\":\"{1}\",\"i\":{2}}}",
                    EscapeJson(type), EscapeJson(name), index);
                _petWindow.PostMessage(msg);
            };
            _studioWindow.OnAssetsChanged += BroadcastConfig;
            _studioWindow.OnQuitAppRequested += Shutdown;
        }

        private void CheckSmokeComplete()
        {
            if (!_smokeTest || !_smokePetReady || !_smokeStudioReady) return;
            Console.WriteLine("SMOKE_ALL_READY");
            Timer t = new Timer();
            t.Interval = 350;
            t.Tick += delegate { t.Stop(); Shutdown(); };
            t.Start();
        }

        private void HandleHotkey(int id)
        {
            if (id == PetWindow.HOTKEY_STUDIO)
            {
                if (_studioWindow.Visible) _studioWindow.HideStudio();
                else OpenStudio();
            }
            else if (id == PetWindow.HOTKEY_CLICKTHROUGH)
            {
                bool next = !_store.Current.clickThrough;
                ApplyPatch(new Dictionary<string, object> { { "clickThrough", next } }, false);
                if (_tray != null)
                {
                    _tray.ShowBalloonTip(1400, "KuroDesk",
                        next ? "已开启鼠标穿透（Ctrl+Alt+P 随时解除）" : "已关闭鼠标穿透（可拖动桌宠）",
                        ToolTipIcon.None);
                }
            }
            else if (id == PetWindow.HOTKEY_DOCKMODE)
            {
                string next = _store.Current.dockMode == "peek" ? "desk" : "peek";
                ApplyPatch(new Dictionary<string, object> { { "dockMode", next } }, false);
            }
            else if (id == PetWindow.HOTKEY_TOGGLE_VIS)
            {
                _petWindow.ToggleUserVisible();
            }
        }

        private void ApplyPatch(Dictionary<string, object> patch, bool deferSave)
        {
            bool geomAffecting = patch.ContainsKey("scale") || patch.ContainsKey("dockMode");
            bool flagAffecting = patch.ContainsKey("clickThrough") || patch.ContainsKey("topMost");
            bool themeAffecting = patch.ContainsKey("studioTheme");

            bool changed = _store.ApplyPatch(patch, !deferSave);
            if (changed && deferSave)
            {
                _configDirty = true;
                _lastPatchUtc = DateTime.UtcNow;
            }
            if (_audio != null) _audio.Enabled = _store.Current.audioReactive;

            if (geomAffecting) _petWindow.ApplyGeometryFromConfig();
            if (flagAffecting) _petWindow.ApplyFlagsFromConfig();
            if (themeAffecting) _studioWindow.SyncWindowTheme();

            // When deferring save (live slider drag from Studio), push immediately to Pet without echoing back and thrashing Studio's slider
            if (deferSave)
            {
                _petWindow.PushConfig();
                SyncTrayMenu();
            }
            else
            {
                BroadcastConfig();
            }
        }

        private void FlushPendingSave(bool force)
        {
            if (!_configDirty && !force) return;
            if (!force && (DateTime.UtcNow - _lastPatchUtc).TotalMilliseconds < 450) return;
            _configDirty = false;
            _store.Save();
        }

        private void BroadcastConfig()
        {
            _petWindow.PushConfig();
            _studioWindow.PushConfig();
            SyncTrayMenu();
        }

        private void OnGlobalKey(int row, int col, int hand, int kind, int vk, bool isDown)
        {
            if (isDown)
            {
                _store.EnsureTodayDate();
                _store.Current.todayKeys++;
            }
            string payload = string.Format(
                CultureInfo.InvariantCulture,
                "{{\"t\":\"k\",\"r\":{0},\"c\":{1},\"h\":{2},\"k\":{3},\"vk\":{4},\"d\":{5},\"tk\":{6}}}",
                row, col, hand, kind, vk, isDown ? 1 : 0, _store.Current.todayKeys);
            _petWindow.PostMessage(payload);
            _studioWindow.PushTelemetry(payload);
        }

        private void OnGlobalShortcutMeme(string memeId)
        {
            if (!_store.Current.shortcutMemes) return;
            string payload = "{\"t\":\"meme\",\"id\":\"" + memeId + "\"}";
            _petWindow.PostMessage(payload);
            _studioWindow.PushTelemetry(payload);
        }

        private void OnGlobalMouseMove(int sx, int sy)
        {
            _cursorX = sx;
            _cursorY = sy;
            _cursorDirty = true;
        }

        private void OnGlobalMouseButton(int button, bool isDown, int sx, int sy)
        {
            if (button == 0 && !isDown) _petWindow.EndDragIfNeeded();
            if (isDown)
            {
                _store.EnsureTodayDate();
                _store.Current.todayClicks++;
            }
            string payload = string.Format(
                CultureInfo.InvariantCulture,
                "{{\"t\":\"mb\",\"b\":{0},\"d\":{1},\"tc\":{2}}}",
                button, isDown ? 1 : 0, _store.Current.todayClicks);
            _petWindow.PostMessage(payload);
            _studioWindow.PushTelemetry(payload);
        }

        private void OnGlobalMouseWheel(int delta)
        {
            string payload = string.Format(CultureInfo.InvariantCulture, "{{\"t\":\"mw\",\"dy\":{0}}}", delta);
            _petWindow.PostMessage(payload);
            _studioWindow.PushTelemetry(payload);
        }

        private void OnFrameTick(object sender, EventArgs e)
        {
            // Drain low-level hook queue safely on the UI thread (keeps OS hook callback sub-microsecond!)
            if (_hook != null) _hook.DrainEvents();

            _petWindow.TickFrame(_lastSnapshot);

            // Push exact screen-space cursor + pet window coordinates for true millimeter eye-tracking!
            if (_cursorDirty && _petWindow.IsUiLoaded)
            {
                _cursorDirty = false;
                int vx = Win32Native.GetSystemMetrics(Win32Native.SM_XVIRTUALSCREEN);
                int vy = Win32Native.GetSystemMetrics(Win32Native.SM_YVIRTUALSCREEN);
                int vw = Math.Max(1, Win32Native.GetSystemMetrics(Win32Native.SM_CXVIRTUALSCREEN));
                int vh = Math.Max(1, Win32Native.GetSystemMetrics(Win32Native.SM_CYVIRTUALSCREEN));

                string payload = string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"t\":\"mm\",\"sx\":{0},\"sy\":{1},\"wx\":{2},\"wy\":{3},\"ww\":{4},\"wh\":{5},\"vx\":{6},\"vy\":{7},\"vw\":{8},\"vh\":{9}}}",
                    _cursorX, _cursorY,
                    _petWindow.Left, _petWindow.Top, Math.Max(1, _petWindow.Width), Math.Max(1, _petWindow.Height),
                    vx, vy, vw, vh);
                _petWindow.PostMessage(payload);
            }

            // Push WASAPI audio telemetry at ~30Hz ONLY while active (plus one clean zero transition packet)
            _audioPushDivider++;
            if (_audio != null && _store.Current.audioReactive && (_audioPushDivider % 2 == 0))
            {
                bool activeNow = _audio.IsPlaying || _audio.Level > 0.005f;
                if (activeNow || _wasAudioActive)
                {
                    _wasAudioActive = activeNow;
                    string aud = string.Format(
                        CultureInfo.InvariantCulture,
                        "{{\"t\":\"aud\",\"lvl\":{0:F3},\"bass\":{1:F3},\"beat\":{2:F3},\"play\":{3}}}",
                        activeNow ? _audio.Level : 0f,
                        activeNow ? _audio.Bass : 0f,
                        activeNow ? _audio.Beat : 0f,
                        activeNow && _audio.IsPlaying ? "true" : "false");
                    _petWindow.PostMessage(aud);
                    _studioWindow.PushTelemetry(aud);
                }
            }
        }

        private void OnContextTick(object sender, EventArgs e)
        {
            if (_smokeTest) return;
            FlushPendingSave(false);

            IntPtr petH = _petWindow.IsHandleCreated ? _petWindow.Handle : IntPtr.Zero;
            IntPtr studioH = _studioWindow.IsHandleCreated ? _studioWindow.Handle : IntPtr.Zero;

            _lastSnapshot = _context.Poll(petH, studioH, _store.Current.ambientFusion);
            PushCurrentContext(false);
        }

        private void PushCurrentContext(bool force)
        {
            if (_lastSnapshot == null) return;
            bool catChanged = _lastSnapshot.AppCategory != _lastSentContextCat
                || _lastSnapshot.ProcessName != _lastSentProc
                || _lastSnapshot.IsLateNight != _lastSentNight;
            bool ambChanged = Math.Abs(_lastSnapshot.AmbientColor.R - _lastSentAmbR) >= 3
                || Math.Abs(_lastSnapshot.AmbientColor.G - _lastSentAmbG) >= 3
                || Math.Abs(_lastSnapshot.AmbientColor.B - _lastSentAmbB) >= 3;

            if (!force && !catChanged && !ambChanged) return;

            _lastSentContextCat = _lastSnapshot.AppCategory;
            _lastSentProc = _lastSnapshot.ProcessName;
            _lastSentNight = _lastSnapshot.IsLateNight;
            _lastSentAmbR = _lastSnapshot.AmbientColor.R;
            _lastSentAmbG = _lastSnapshot.AmbientColor.G;
            _lastSentAmbB = _lastSnapshot.AmbientColor.B;

            string ctxMsg = string.Format(
                CultureInfo.InvariantCulture,
                "{{\"t\":\"ctx\",\"cat\":\"{0}\",\"proc\":\"{1}\",\"night\":{2},\"ar\":{3},\"ag\":{4},\"ab\":{5},\"alum\":{6:F3}}}",
                _lastSnapshot.AppCategory,
                EscapeJson(_lastSnapshot.ProcessName),
                _lastSnapshot.IsLateNight ? "true" : "false",
                _lastSnapshot.AmbientColor.R,
                _lastSnapshot.AmbientColor.G,
                _lastSnapshot.AmbientColor.B,
                _lastSnapshot.AmbientLuminance);

            _petWindow.PostMessage(ctxMsg);
            _studioWindow.PushTelemetry(ctxMsg);
        }

        private NotifyIcon BuildTrayIcon()
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            ToolStripMenuItem openStudio = new ToolStripMenuItem("打开 KuroStudio 后台工坊 (Ctrl+Alt+S)", null,
                delegate { OpenStudio(); });
            openStudio.Font = new Font(openStudio.Font, FontStyle.Bold);
            menu.Items.Add(openStudio);
            menu.Items.Add(new ToolStripSeparator());

            _miPeekMode = new ToolStripMenuItem("趴窗磁吸模式 (Ctrl+Alt+D)", null,
                delegate { HandleHotkey(PetWindow.HOTKEY_DOCKMODE); });
            _miClickThrough = new ToolStripMenuItem("鼠标穿透锁定 (Ctrl+Alt+P)", null,
                delegate { HandleHotkey(PetWindow.HOTKEY_CLICKTHROUGH); });
            menu.Items.Add(_miPeekMode);
            menu.Items.Add(_miClickThrough);

            menu.Items.Add(new ToolStripMenuItem("显示 / 隐藏桌宠 (Ctrl+Alt+H)", null,
                delegate { _petWindow.ToggleUserVisible(); }));
            menu.Items.Add(new ToolStripMenuItem("复位桌宠到右下角", null,
                delegate { _petWindow.ResetDeskPosition(); _studioWindow.PushConfig(); SyncTrayMenu(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("退出 KuroDesk", null, delegate { Shutdown(); }));

            NotifyIcon ni = new NotifyIcon();
            ni.Icon = _appIcon;
            ni.Text = "KuroDesk · 单击打开后台工坊";
            ni.ContextMenuStrip = menu;
            ni.Visible = !_smokeTest;
            ni.MouseClick += delegate(object s, MouseEventArgs me)
            {
                if (me.Button == MouseButtons.Left) OpenStudio();
            };

            SyncTrayMenu();
            return ni;
        }

        private void SyncTrayMenu()
        {
            if (_miClickThrough != null) _miClickThrough.Checked = _store.Current.clickThrough;
            if (_miPeekMode != null) _miPeekMode.Checked = (_store.Current.dockMode == "peek");
        }

        private static Icon CreateBrandTrayIcon()
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                // Refined warm sumi-ink chibi cat icon with amber-gold eyes & vermilion accent
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(255, 43, 40, 52)))
                {
                    PointF[] lEar = { new PointF(4, 16), new PointF(5, 3), new PointF(14, 11) };
                    PointF[] rEar = { new PointF(28, 16), new PointF(27, 3), new PointF(18, 11) };
                    g.FillPolygon(bg, lEar);
                    g.FillPolygon(bg, rEar);
                    g.FillEllipse(bg, 3, 9, 26, 21);
                }
                using (SolidBrush scarf = new SolidBrush(Color.FromArgb(255, 214, 90, 56)))
                {
                    g.FillEllipse(scarf, 8, 25, 16, 5);
                }
                using (SolidBrush eye = new SolidBrush(Color.FromArgb(255, 236, 174, 62)))
                using (SolidBrush pup = new SolidBrush(Color.FromArgb(255, 34, 24, 20)))
                using (SolidBrush dot = new SolidBrush(Color.FromArgb(255, 255, 250, 240)))
                {
                    g.FillEllipse(eye, 7.8f, 15.2f, 6.6f, 6.4f);
                    g.FillEllipse(eye, 17.6f, 15.2f, 6.6f, 6.4f);
                    g.FillEllipse(pup, 9.6f, 16.5f, 3.0f, 3.8f);
                    g.FillEllipse(pup, 19.4f, 16.5f, 3.0f, 3.8f);
                    g.FillEllipse(dot, 9.1f, 16.0f, 1.9f, 1.9f);
                    g.FillEllipse(dot, 18.9f, 16.0f, 1.9f, 1.9f);
                }

                IntPtr hIcon = bmp.GetHicon();
                try
                {
                    using (Icon tmp = Icon.FromHandle(hIcon)) { return (Icon)tmp.Clone(); }
                }
                finally { Win32Native.DestroyIcon(hIcon); }
            }
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private bool _shuttingDown;
        private void Shutdown()
        {
            if (_shuttingDown) return;
            _shuttingDown = true;

            if (!_smokeTest) _store.Save();

            if (_frameTimer != null) { _frameTimer.Stop(); _frameTimer.Dispose(); }
            if (_contextTimer != null) { _contextTimer.Stop(); _contextTimer.Dispose(); }
            if (_saveTimer != null) { _saveTimer.Stop(); _saveTimer.Dispose(); }
            if (_hook != null) _hook.Dispose();
            if (_audio != null) _audio.Dispose();
            if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
            if (_studioWindow != null && !_studioWindow.IsDisposed) _studioWindow.ForceClose();
            if (_petWindow != null && !_petWindow.IsDisposed) _petWindow.Close();
            if (_appIcon != null) _appIcon.Dispose();

            ExitThread();
        }
    }
}
