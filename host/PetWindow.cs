using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KuroDesk
{
    /// <summary>
    /// 100% pure transparent topmost desktop pet surface.
    /// Zero hover controls, zero intrusive chrome — pure character + desk peripherals.
    /// Supports both Desk Mode (free drag & corner placement) and Window-Peek Magnetic Dock Mode.
    /// </summary>
    internal sealed class PetWindow : Form
    {
        public const int DeskBaseW = 460;
        public const int DeskBaseH = 420;
        public const int PeekBaseW = 320;
        public const int PeekBaseH = 260;

        public const int HOTKEY_STUDIO = 9101;
        public const int HOTKEY_CLICKTHROUGH = 9102;
        public const int HOTKEY_DOCKMODE = 9103;
        public const int HOTKEY_TOGGLE_VIS = 9104;

        private readonly string _uiFolder;
        private readonly ConfigStore _store;
        private readonly bool _debugMode;
        private readonly bool _smokeTest;

        private WebView2Host _webView;
        private bool _uiLoaded;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        // Dragging state (Desk mode only)
        private bool _isDragging;
        private Point _dragStartCursor;
        private Point _dragStartForm;

        // Magnetic Window-Peek smooth glide coordinates
        private double _peekPosX = double.NaN;
        private double _peekPosY = double.NaN;
        private bool _hiddenForFullscreen = false;
        private bool _pausedForFullscreen = false;
        private bool _userHidden = false;
        private readonly Dictionary<int, bool> _hotkeyStatus = new Dictionary<int, bool>();

        public event Action OnUiReady;
        public event Action<int> OnHotkeyPressed;
        public event Action<double> OnScaleDeltaRequested;
        public event Action OnOpenStudioRequested;

        public bool IsUiLoaded { get { return _uiLoaded; } }
        public Dictionary<int, bool> HotkeyStatus { get { return _hotkeyStatus; } }

        public PetWindow(string uiFolder, ConfigStore store, bool debugMode, bool smokeTest)
        {
            _uiFolder = uiFolder;
            _store = store;
            _debugMode = debugMode;
            _smokeTest = smokeTest;

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = _store.Current.topMost;
            BackColor = Color.Black;
            Text = "KuroDesk Pet";
            DoubleBuffered = true;

            ApplyGeometryFromConfig();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= Win32Native.WS_EX_TOOLWINDOW;
                if (_store != null && _store.Current.topMost)
                {
                    cp.ExStyle |= Win32Native.WS_EX_TOPMOST;
                }
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Win32Native.EnableTransparentComposition(Handle);
            Win32Native.SetAlwaysOnTop(Handle, _store.Current.topMost);
            if (_store.Current.clickThrough)
            {
                Win32Native.SetClickThrough(Handle, true);
            }

            _hotkeyStatus[HOTKEY_STUDIO] = Win32Native.RegisterHotKey(Handle, HOTKEY_STUDIO,
                Win32Native.MOD_CONTROL | Win32Native.MOD_ALT | Win32Native.MOD_NOREPEAT, (uint)Keys.S);
            _hotkeyStatus[HOTKEY_CLICKTHROUGH] = Win32Native.RegisterHotKey(Handle, HOTKEY_CLICKTHROUGH,
                Win32Native.MOD_CONTROL | Win32Native.MOD_ALT | Win32Native.MOD_NOREPEAT, (uint)Keys.P);
            _hotkeyStatus[HOTKEY_DOCKMODE] = Win32Native.RegisterHotKey(Handle, HOTKEY_DOCKMODE,
                Win32Native.MOD_CONTROL | Win32Native.MOD_ALT | Win32Native.MOD_NOREPEAT, (uint)Keys.D);
            _hotkeyStatus[HOTKEY_TOGGLE_VIS] = Win32Native.RegisterHotKey(Handle, HOTKEY_TOGGLE_VIS,
                Win32Native.MOD_CONTROL | Win32Native.MOD_ALT | Win32Native.MOD_NOREPEAT, (uint)Keys.H);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (_webView != null) return;

            _webView = new WebView2Host();
            _webView.OnReady += delegate
            {
                if (_smokeTest) Console.WriteLine("SMOKE_PET_WV2_READY");
            };
            _webView.OnWebMessage += HandleWebMessage;
            _webView.OnError += delegate(string msg)
            {
                Console.Error.WriteLine("PET_WV2_ERROR: " + msg);
                if (_smokeTest)
                {
                    Environment.ExitCode = 2;
                    Close();
                }
                else
                {
                    MessageBox.Show(
                        "KuroDesk 渲染引擎初始化失败：\n" + msg + "\n\n请确认已安装 Microsoft Edge WebView2 运行时。",
                        "KuroDesk",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    Close();
                }
            };
            _webView.Initialize(
                Handle,
                _uiFolder,
                _store.AssetsFolder,
                Path.Combine(_store.DataFolder, "WebView2Cache"),
                "pet.html",
                true,
                0x00000000u,
                _debugMode);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (_webView != null) _webView.ResizeToBounds(ClientSize.Width, ClientSize.Height);
        }

        protected override void OnLocationChanged(EventArgs e)
        {
            base.OnLocationChanged(e);
            if (_webView != null) _webView.NotifyMoved();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Win32Native.WM_HOTKEY)
            {
                Action<int> h = OnHotkeyPressed;
                if (h != null) h(m.WParam.ToInt32());
            }
            else if (Program.WakeMessageId != 0 && (uint)m.Msg == Program.WakeMessageId)
            {
                Action open = OnOpenStudioRequested;
                if (open != null) open();
            }
            base.WndProc(ref m);
        }

        private void HandleWebMessage(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return;
            try
            {
                Dictionary<string, object> msg = _json.Deserialize<Dictionary<string, object>>(raw);
                if (msg == null || !msg.ContainsKey("cmd")) return;
                string cmd = Convert.ToString(msg["cmd"]);

                if (cmd == "ready")
                {
                    _uiLoaded = true;
                    PushConfig();
                    Action ready = OnUiReady;
                    if (ready != null) ready();
                }
                else if (cmd == "startDrag")
                {
                    if (!_store.Current.clickThrough && _store.Current.dockMode != "peek")
                    {
                        Win32Native.POINT pt;
                        if (Win32Native.GetCursorPos(out pt))
                        {
                            _isDragging = true;
                            _dragStartCursor = new Point(pt.X, pt.Y);
                            _dragStartForm = Location;
                        }
                    }
                }
                else if (cmd == "deltaScale" && msg.ContainsKey("value"))
                {
                    double dv = Convert.ToDouble(msg["value"], CultureInfo.InvariantCulture);
                    Action<double> sc = OnScaleDeltaRequested;
                    if (sc != null) sc(dv);
                }
                else if (cmd == "openStudio")
                {
                    Action open = OnOpenStudioRequested;
                    if (open != null) open();
                }
            }
            catch { }
        }

        public void PushConfig()
        {
            if (!_uiLoaded || _webView == null) return;
            _webView.PostJson("{\"t\":\"cfg\",\"cfg\":" + _store.SerializeConfig() + "}");
        }

        public void PostMessage(string json)
        {
            if (!_uiLoaded || _webView == null) return;
            _webView.PostJson(json);
        }

        public void ApplyFlagsFromConfig()
        {
            if (!IsHandleCreated) return;
            TopMost = _store.Current.topMost;
            Win32Native.SetAlwaysOnTop(Handle, _store.Current.topMost);
            Win32Native.SetClickThrough(Handle, _store.Current.clickThrough);
        }

        public void ApplyGeometryFromConfig()
        {
            AppConfig cfg = _store.Current;
            double sc = Math.Max(0.55, Math.Min(1.85, cfg.scale));
            bool isPeek = cfg.dockMode == "peek";
            int baseW = isPeek ? PeekBaseW : DeskBaseW;
            int baseH = isPeek ? PeekBaseH : DeskBaseH;
            int w = (int)Math.Round(baseW * sc);
            int h = (int)Math.Round(baseH * sc);

            if (isPeek)
            {
                Size = new Size(w, h);
                return;
            }

            // Preserve bottom-right anchor when resizing in Desk mode
            bool hasExisting = (Width > 0 && Height > 0 && cfg.x != int.MinValue && cfg.y != int.MinValue);
            if (hasExisting && (Width != w || Height != h))
            {
                int oldRight = Left + Width;
                int oldBottom = Top + Height;
                Size = new Size(w, h);
                Location = new Point(oldRight - w, oldBottom - h);
                cfg.x = Location.X;
                cfg.y = Location.Y;
                return;
            }

            Size = new Size(w, h);
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            if (cfg.x == int.MinValue || cfg.y == int.MinValue)
            {
                cfg.x = wa.Right - w - 20;
                cfg.y = wa.Bottom - h - 8;
            }
            else
            {
                int vx = Win32Native.GetSystemMetrics(Win32Native.SM_XVIRTUALSCREEN);
                int vy = Win32Native.GetSystemMetrics(Win32Native.SM_YVIRTUALSCREEN);
                int vw = Win32Native.GetSystemMetrics(Win32Native.SM_CXVIRTUALSCREEN);
                int vh = Win32Native.GetSystemMetrics(Win32Native.SM_CYVIRTUALSCREEN);
                if (cfg.x < vx - w + 60 || cfg.x > vx + vw - 60 || cfg.y < vy - h + 60 || cfg.y > vy + vh - 60)
                {
                    cfg.x = wa.Right - w - 20;
                    cfg.y = wa.Bottom - h - 8;
                }
            }
            Location = new Point(cfg.x, cfg.y);
            _peekPosX = double.NaN;
            _peekPosY = double.NaN;
        }

        public void ResetDeskPosition()
        {
            _store.Current.dockMode = "desk";
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int w = (int)Math.Round(DeskBaseW * _store.Current.scale);
            int h = (int)Math.Round(DeskBaseH * _store.Current.scale);
            Size = new Size(w, h);
            _store.Current.x = wa.Right - w - 20;
            _store.Current.y = wa.Bottom - h - 8;
            Location = new Point(_store.Current.x, _store.Current.y);
            _store.Save();
            PushConfig();
        }

        public void SetUserVisible(bool vis)
        {
            _userHidden = !vis;
            Visible = vis && !_hiddenForFullscreen;
        }

        public void ToggleUserVisible()
        {
            SetUserVisible(_userHidden);
        }

        public void EndDragIfNeeded()
        {
            if (!_isDragging) return;
            _isDragging = false;
            _store.Current.x = Location.X;
            _store.Current.y = Location.Y;
            _store.Save();
        }

        public void TickFrame(SystemSnapshot sysSnap)
        {
            // 1. Handle smooth dragging in Desk Mode
            if (_isDragging)
            {
                if ((Win32Native.GetAsyncKeyState(0x01) & 0x8000) == 0)
                {
                    EndDragIfNeeded();
                }
                else
                {
                    Win32Native.POINT pt;
                    if (Win32Native.GetCursorPos(out pt))
                    {
                        Location = new Point(
                            _dragStartForm.X + (pt.X - _dragStartCursor.X),
                            _dragStartForm.Y + (pt.Y - _dragStartCursor.Y));
                    }
                }
            }

            // 2. Fullscreen Auto-Pause & Energy Saver (applies cleanly to both Desk and Peek mode)
            bool isFs = (sysSnap != null && sysSnap.HasDockTarget && sysSnap.IsTargetFullscreen);
            bool wantPause = isFs && _store.Current.pauseOnFullscreen;
            if (wantPause != _pausedForFullscreen)
            {
                _pausedForFullscreen = wantPause;
                PostMessage(wantPause ? "{\"t\":\"pause\",\"p\":true}" : "{\"t\":\"pause\",\"p\":false}");
            }

            // 3. Handle Magnetic Window-Peek Docking Mode (Direction 4)
            if (_store.Current.dockMode == "peek" && !_userHidden)
            {
                if (isFs)
                {
                    if (!_hiddenForFullscreen)
                    {
                        _hiddenForFullscreen = true;
                        Visible = false;
                    }
                }
                else
                {
                    if (_hiddenForFullscreen)
                    {
                        _hiddenForFullscreen = false;
                        Visible = true;
                    }

                    int idealX, idealY;
                    if (sysSnap != null && sysSnap.HasDockTarget)
                    {
                        Win32Native.RECT tr = sysSnap.TargetRect;
                        int targetW = tr.Right - tr.Left;
                        idealX = targetW > Width + 220
                            ? tr.Right - Width - 165
                            : tr.Left + (targetW - Width) / 2;
                        int pawOverlap = (int)Math.Round(Height * 0.74);
                        idealY = tr.Top - pawOverlap;

                        Screen scr = Screen.FromPoint(new Point((tr.Left + tr.Right) / 2, (tr.Top + tr.Bottom) / 2));
                        if (idealY < scr.Bounds.Top - (int)(Height * 0.25))
                        {
                            idealY = scr.Bounds.Top - (int)(Height * 0.12);
                        }
                    }
                    else
                    {
                        // Gracefully perch on bottom-right taskbar edge when desktop is empty / all windows minimized
                        Rectangle wa = Screen.PrimaryScreen.WorkingArea;
                        idealX = wa.Right - Width - 28;
                        idealY = wa.Bottom - (int)Math.Round(Height * 0.78);
                    }

                    if (double.IsNaN(_peekPosX))
                    {
                        _peekPosX = idealX;
                        _peekPosY = idealY;
                    }
                    else
                    {
                        _peekPosX += (idealX - _peekPosX) * 0.22;
                        _peekPosY += (idealY - _peekPosY) * 0.22;
                    }

                    int nx = (int)Math.Round(_peekPosX);
                    int ny = (int)Math.Round(_peekPosY);
                    if (Math.Abs(nx - Location.X) >= 1 || Math.Abs(ny - Location.Y) >= 1)
                    {
                        Location = new Point(nx, ny);
                    }
                }
            }
            else if (_hiddenForFullscreen)
            {
                _hiddenForFullscreen = false;
                if (!_userHidden) Visible = true;
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (_webView != null) { _webView.Dispose(); _webView = null; }
            try
            {
                Win32Native.UnregisterHotKey(Handle, HOTKEY_STUDIO);
                Win32Native.UnregisterHotKey(Handle, HOTKEY_CLICKTHROUGH);
                Win32Native.UnregisterHotKey(Handle, HOTKEY_DOCKMODE);
                Win32Native.UnregisterHotKey(Handle, HOTKEY_TOGGLE_VIS);
            }
            catch { }
            base.OnFormClosing(e);
        }
    }
}
