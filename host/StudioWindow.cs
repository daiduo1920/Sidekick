using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KuroDesk
{
    /// <summary>
    /// Native C-End KuroStudio Configuration Dashboard window.
    /// Hosts studio.html with dark Windows 11 titlebar, real-time interactive preview,
    /// modular Avatar/Keyboard/Mouse/Desk Workshop, and local asset import dialogs.
    /// Closing the window hides it cleanly to the tray while keeping the desktop pet alive.
    /// </summary>
    internal sealed class StudioWindow : Form
    {
        private readonly string _uiFolder;
        private readonly ConfigStore _store;
        private readonly AssetManager _assets;
        private readonly bool _debugMode;
        private readonly bool _smokeTest;

        private WebView2Host _webView;
        private bool _uiLoaded;
        private bool _allowClose;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public event Action<Dictionary<string, object>, bool> OnConfigPatch;
        public event Action OnResetPositionRequested;
        public event Action<string> OnPreviewActionRequested;
        public event Action<string, string, int> OnModelTriggerRequested; // type ("exp"|"motion"), name/group, index
        public event Action OnAssetsChanged;
        public event Action OnQuitAppRequested;
        public event Action OnStudioReady;

        public bool IsUiLoaded { get { return _uiLoaded; } }

        public StudioWindow(string uiFolder, ConfigStore store, AssetManager assets, Icon appIcon, bool debugMode, bool smokeTest)
        {
            _uiFolder = uiFolder;
            _store = store;
            _assets = assets;
            _debugMode = debugMode;
            _smokeTest = smokeTest;

            Text = "KuroStudio · 墨丸桌面伴侣工坊";
            if (appIcon != null) Icon = appIcon;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1100, 720);
            MinimumSize = new Size(920, 600);
            bool isDark = _store.Current.studioTheme == "atelier-dark";
            BackColor = isDark ? Color.FromArgb(23, 22, 24) : Color.FromArgb(245, 242, 235);
            DoubleBuffered = true;
        }

        public void SyncWindowTheme()
        {
            bool isDark = _store.Current.studioTheme == "atelier-dark";
            BackColor = isDark ? Color.FromArgb(23, 22, 24) : Color.FromArgb(245, 242, 235);
            if (IsHandleCreated)
            {
                Win32Native.SetDarkTitleBar(Handle, isDark);
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SyncWindowTheme();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            EnsureWebViewInitialized();
        }

        public void ShowStudio()
        {
            if (!Visible)
            {
                Show();
            }
            if (WindowState == FormWindowState.Minimized)
            {
                WindowState = FormWindowState.Normal;
            }
            Activate();
            BringToFront();
            EnsureWebViewInitialized();
            if (_webView != null) _webView.ResizeToBounds(ClientSize.Width, ClientSize.Height);
            PushConfig();
            NotifyVisibility(true);
        }

        public void HideStudio()
        {
            NotifyVisibility(false);
            Hide();
        }

        public void ForceClose()
        {
            _allowClose = true;
            Close();
        }

        private void EnsureWebViewInitialized()
        {
            if (_webView != null) return;
            _webView = new WebView2Host();
            _webView.OnReady += delegate
            {
                if (_smokeTest) Console.WriteLine("SMOKE_STUDIO_WV2_READY");
            };
            _webView.OnWebMessage += HandleWebMessage;
            _webView.OnError += delegate(string msg)
            {
                Console.Error.WriteLine("STUDIO_WV2_ERROR: " + msg);
                if (!_smokeTest)
                {
                    MessageBox.Show("KuroStudio 配置界面加载失败：\n" + msg, "KuroStudio",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };
            bool isDark = _store.Current.studioTheme == "atelier-dark";
            uint bgColor = isDark ? 0xFF181617u : 0xFFEBF2F5u;
            _webView.Initialize(
                Handle,
                _uiFolder,
                _store.AssetsFolder,
                Path.Combine(_store.DataFolder, "WebView2Cache"),
                "studio.html",
                false,
                bgColor,
                _debugMode);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (_webView != null) _webView.ResizeToBounds(ClientSize.Width, ClientSize.Height);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!_allowClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideStudio();
                return;
            }
            if (_webView != null) { _webView.Dispose(); _webView = null; }
            base.OnFormClosing(e);
        }

        public void NotifyVisibility(bool visible)
        {
            if (!_uiLoaded || _webView == null) return;
            _webView.PostJson(visible ? "{\"t\":\"vis\",\"v\":true}" : "{\"t\":\"vis\",\"v\":false}");
        }

        public void PushConfig()
        {
            if (!_uiLoaded || _webView == null) return;
            _webView.PostJson("{\"t\":\"cfg\",\"cfg\":" + _store.SerializeConfig() + "}");
        }

        public void PushHotkeyStatus(Dictionary<int, bool> status)
        {
            if (!_uiLoaded || _webView == null || status == null) return;
            bool s = status.ContainsKey(PetWindow.HOTKEY_STUDIO) && status[PetWindow.HOTKEY_STUDIO];
            bool d = status.ContainsKey(PetWindow.HOTKEY_DOCKMODE) && status[PetWindow.HOTKEY_DOCKMODE];
            bool p = status.ContainsKey(PetWindow.HOTKEY_CLICKTHROUGH) && status[PetWindow.HOTKEY_CLICKTHROUGH];
            bool h = status.ContainsKey(PetWindow.HOTKEY_TOGGLE_VIS) && status[PetWindow.HOTKEY_TOGGLE_VIS];
            _webView.PostJson(string.Format(
                "{{\"t\":\"hk\",\"s\":{0},\"d\":{1},\"p\":{2},\"h\":{3}}}",
                s ? "true" : "false", d ? "true" : "false", p ? "true" : "false", h ? "true" : "false"));
        }

        public void PushTelemetry(string json)
        {
            if (!_uiLoaded || _webView == null || !Visible) return;
            _webView.PostJson(json);
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
                    NotifyVisibility(Visible);
                    Action ready = OnStudioReady;
                    if (ready != null) ready();
                }
                else if (cmd == "patchConfig" && msg.ContainsKey("patch"))
                {
                    Dictionary<string, object> patch = msg["patch"] as Dictionary<string, object>;
                    bool deferSave = msg.ContainsKey("deferSave") && Convert.ToBoolean(msg["deferSave"]);
                    if (patch != null)
                    {
                        Action<Dictionary<string, object>, bool> h = OnConfigPatch;
                        if (h != null) h(patch, deferSave);
                    }
                }
                else if (cmd == "importAsset")
                {
                    string kind = msg.ContainsKey("kind") ? Convert.ToString(msg["kind"]) : "";
                    string err;
                    CustomAssetEntry entry = _assets.ImportViaDialog(this, kind, out err);
                    if (entry != null)
                    {
                        Action ch = OnAssetsChanged;
                        if (ch != null) ch();
                        _webView.PostJson("{\"t\":\"toast\",\"level\":\"ok\",\"msg\":\"已成功导入资产：" + EscapeJs(entry.name) + "\"}");
                    }
                    else if (!string.IsNullOrEmpty(err))
                    {
                        _webView.PostJson("{\"t\":\"toast\",\"level\":\"err\",\"msg\":\"" + EscapeJs(err) + "\"}");
                    }
                }
                else if (cmd == "importCubismCore")
                {
                    string err;
                    if (_assets.ImportCubismCoreViaDialog(this, out err))
                    {
                        Action ch = OnAssetsChanged;
                        if (ch != null) ch();
                        _webView.PostJson("{\"t\":\"toast\",\"level\":\"ok\",\"msg\":\"已成功安装 Live2D Cubism Core 运行时，现可驱动完整骨骼动画\"}");
                    }
                    else if (!string.IsNullOrEmpty(err))
                    {
                        _webView.PostJson("{\"t\":\"toast\",\"level\":\"err\",\"msg\":\"" + EscapeJs(err) + "\"}");
                    }
                }
                else if (cmd == "deleteAsset" && msg.ContainsKey("id"))
                {
                    string id = Convert.ToString(msg["id"]);
                    if (_assets.DeleteAsset(id))
                    {
                        Action ch = OnAssetsChanged;
                        if (ch != null) ch();
                        _webView.PostJson("{\"t\":\"toast\",\"level\":\"ok\",\"msg\":\"已移除自定义资产\"}");
                    }
                }
                else if (cmd == "openAssetsFolder")
                {
                    try { System.Diagnostics.Process.Start("explorer.exe", _store.AssetsFolder); } catch { }
                }
                else if (cmd == "resetPos")
                {
                    Action r = OnResetPositionRequested;
                    if (r != null) r();
                }
                else if (cmd == "triggerDemo" && msg.ContainsKey("action"))
                {
                    Action<string> d = OnPreviewActionRequested;
                    if (d != null) d(Convert.ToString(msg["action"]));
                }
                else if (cmd == "triggerExpression" && msg.ContainsKey("name"))
                {
                    Action<string, string, int> m = OnModelTriggerRequested;
                    if (m != null) m("exp", Convert.ToString(msg["name"]), 0);
                }
                else if (cmd == "triggerMotion" && msg.ContainsKey("group"))
                {
                    int idx = msg.ContainsKey("index") ? Convert.ToInt32(msg["index"]) : 0;
                    Action<string, string, int> m = OnModelTriggerRequested;
                    if (m != null) m("motion", Convert.ToString(msg["group"]), idx);
                }
                else if (cmd == "openUrl" && msg.ContainsKey("url"))
                {
                    string u = Convert.ToString(msg["url"]);
                    if (!string.IsNullOrEmpty(u) && (u.StartsWith("https://") || u.StartsWith("http://")))
                    {
                        try { System.Diagnostics.Process.Start(u); } catch { }
                    }
                }
                else if (cmd == "quitApp")
                {
                    Action q = OnQuitAppRequested;
                    if (q != null) q();
                }
            }
            catch { }
        }

        private static string EscapeJs(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }
    }
}
