using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace KuroDesk
{
    public sealed class CustomAssetEntry
    {
        public string id = "";
        public string name = "";
        public string kind = "";      // "avatar25d" | "avatar3d" | "live2d" | "vrma" | "soundpack"
        public string entryUrl = "";  // https://kuro-assets.local/<id>/<file>
        public string previewUrl = ""; // Resolved portrait/texture URL (extracted VRM thumb or Live2D cover/texture)
        public string bongoManifestUrl = ""; // Optional kuro_bongocat.json for BongoCat / BongoCatMver key overlays
        public string folderName = "";
        public double eyeAnchorX = 0.48;
        public double eyeAnchorY = 0.34;
        public double scale = 1.0;
        public double offsetY = 0.0;
        public string notes = "";
    }

    public sealed class AppConfig
    {
        public int version = 5;

        // Active Character & Engine Settings
        public string avatar = "vrm-sample-a";       // vrm-sample-a | vrm-sample-b | vrm-vita | vrm-seed | custom:<id>
        public string avatarVariant = "";
        public string shader3d = "mtoon";            // mtoon | pbr
        public string vrmCamera = "bust";            // bust | full
        public string vrmaUrl = "";                  // Optional custom .vrma animation URL
        public string keyboard = "signature";
        public string mouseGear = "pebble-wireless";
        public string deskMat = "minimal-felt";
        public string palette = "washi-amber";
        public string studioTheme = "atelier-light"; // atelier-light | atelier-dark

        // Placement & Window
        public string dockMode = "desk";             // "desk" | "peek" (Window-Edge Smart Dock!)
        public double scale = 1.0;
        public int x = int.MinValue;
        public int y = int.MinValue;
        public bool clickThrough = false;
        public bool topMost = true;
        public bool autoStart = false;               // Launch KuroDesk at Windows sign-in
        public bool pauseOnFullscreen = true;        // Auto-pause animation & mute during fullscreen games/movies
        public bool firstRunDone = false;            // Auto-open Studio once on first launch for onboarding
        public bool hasCubismCore = false;           // Live2D Cubism Core runtime installed in assets/__runtime/

        // Interactive & Smart Features (All 6 bold directions!)
        public bool eyeTrackCursor = true;           // True screen-space eye vector + near proximity interaction
        public bool eyeProximityFX = true;           // Near convergence + curious tilt + dizzy circle
        public bool petting = true;
        public bool appContextAuto = true;           // Direction 1: Coding/Gaming/Media/Creative auto props & gear
        public bool audioReactive = true;            // Direction 2: WASAPI Loopback music beat head-bob & LED
        public bool shortcutMemes = true;            // Direction 3: Ctrl+Z / Ctrl+S / Ctrl+C+V / Enter memes
        public bool ambientFusion = true;            // Direction 6: Wallpaper ambient color rim-light & shadow fusion

        // Props & Sound
        public bool sound = true;
        public string soundPack = "creamy-thock";    // creamy-thock | tactile-blue | silent-plush | custom:<id>
        public double soundVolume = 0.72;
        public bool propCoffee = true;               // Auto on late-night/coding or always visible
        public bool propHeadphones = true;           // Auto on media/audio
        public bool propLedStrip = true;             // Desk ambient / audio-reactive LED bar
        public bool showMiniCounter = false;         // Pet stage stays 100% clean by default; opt-in counter!

        // Custom calibration overrides for imported assets
        public double customEyeX = 0.48;
        public double customEyeY = 0.34;
        public double customScale = 1.0;
        public double customOffsetY = 0.0;

        // Daily Stats
        public string statsDate = "";
        public int todayKeys = 0;
        public int todayClicks = 0;

        // Imported custom assets metadata
        public List<CustomAssetEntry> customAssets = new List<CustomAssetEntry>();
    }

    internal sealed class ConfigStore
    {
        private readonly string _dataFolder;
        private readonly string _configPath;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly object _saveLock = new object();

        public string CubismCorePath { get { return Path.Combine(AssetsFolder, "__runtime", "live2dcubismcore.min.js"); } }
        public string DataFolder { get { return _dataFolder; } }
        public string AssetsFolder { get { return Path.Combine(_dataFolder, "assets"); } }
        public AppConfig Current { get; private set; }

        private const string AutoStartRegPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string AutoStartRegName = "KuroDesk";

        public ConfigStore()
        {
            _dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "KuroDesk");
            _configPath = Path.Combine(_dataFolder, "config_v2.json");
            Directory.CreateDirectory(_dataFolder);
            Directory.CreateDirectory(AssetsFolder);
            Load();
        }

        public void Load()
        {
            Current = new AppConfig();
            try
            {
                if (File.Exists(_configPath))
                {
                    string raw = File.ReadAllText(_configPath);
                    AppConfig parsed = _json.Deserialize<AppConfig>(raw);
                    if (parsed != null)
                    {
                        Current = parsed;
                        if (Current.customAssets == null)
                        {
                            Current.customAssets = new List<CustomAssetEntry>();
                        }
                    }
                }
            }
            catch { }

            MigrateConfig();
            Current.autoStart = ReadAutoStartRegistry();
            RefreshRuntimeFlags();
            EnsureTodayDate();
        }

        private void MigrateConfig()
        {
            if (Current.version < 3)
            {
                if (Current.palette == "midnight-jade" || Current.palette == "obsidian-gold")
                    Current.palette = "washi-amber";
                else if (Current.palette == "ice-sakura")
                    Current.palette = "sakura-cream";
                else if (Current.palette == "matcha-latte")
                    Current.palette = "matcha-mist";
                else if (Current.palette == "cyber-violet")
                    Current.palette = "dusk-indigo";
                if (Current.shader3d == "toon") Current.shader3d = "mtoon";
                if (string.IsNullOrEmpty(Current.studioTheme)) Current.studioTheme = "atelier-light";
            }
            if (Current.version < 5)
            {
                Current.version = 5;
                if (Current.avatar == "kuro-anime" || Current.avatar == "mochi-cat" || Current.avatar == "figurine-3d"
                    || Current.avatar == "yuki-anime" || Current.avatar == "ehon-shiratama" || Current.avatar == "ehon-sumi"
                    || Current.avatar == "pixel-lofi" || Current.avatar == "pixel-matcha" || Current.avatar == "riso-designer"
                    || Current.avatar == "dj-nova" || Current.avatar == "cyber-hacker" || Current.avatar == "urban-mecha"
                    || Current.avatar == "star-witch" || Current.avatar == "manga-rock" || Current.avatar == "ink-sword"
                    || string.IsNullOrEmpty(Current.avatar))
                {
                    Current.avatar = "vrm-sample-a";
                    Current.avatarVariant = "";
                }
            }
            if (Current.avatarVariant == null) Current.avatarVariant = "";
            if (string.IsNullOrEmpty(Current.vrmCamera)) Current.vrmCamera = "bust";
            if (Current.vrmaUrl == null) Current.vrmaUrl = "";
            if (string.IsNullOrEmpty(Current.studioTheme)) Current.studioTheme = "atelier-light";
        }

        public void RefreshRuntimeFlags()
        {
            string localVendorCore = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui", "vendor", "live2dcubismcore.min.js");
            Current.hasCubismCore = File.Exists(CubismCorePath) || File.Exists(localVendorCore);
        }

        public void Save()
        {
            lock (_saveLock)
            {
                try
                {
                    Directory.CreateDirectory(_dataFolder);
                    string tmp = _configPath + ".tmp";
                    File.WriteAllText(tmp, _json.Serialize(Current));
                    if (File.Exists(_configPath))
                    {
                        try
                        {
                            File.Replace(tmp, _configPath, null, true);
                        }
                        catch
                        {
                            File.Delete(_configPath);
                            File.Move(tmp, _configPath);
                        }
                    }
                    else
                    {
                        File.Move(tmp, _configPath);
                    }
                }
                catch { }
            }
        }

        public static bool ReadAutoStartRegistry()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(AutoStartRegPath, false))
                {
                    if (key == null) return false;
                    string val = key.GetValue(AutoStartRegName) as string;
                    return !string.IsNullOrEmpty(val);
                }
            }
            catch { return false; }
        }

        public static bool SyncAutoStartRegistry(bool enabled)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(AutoStartRegPath, true))
                {
                    if (key == null) return false;
                    if (enabled)
                    {
                        key.SetValue(AutoStartRegName, "\"" + Application.ExecutablePath + "\"");
                    }
                    else
                    {
                        if (key.GetValue(AutoStartRegName) != null) key.DeleteValue(AutoStartRegName, false);
                    }
                    return true;
                }
            }
            catch { return false; }
        }

        public void EnsureTodayDate()
        {
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            if (Current.statsDate != today)
            {
                Current.statsDate = today;
                Current.todayKeys = 0;
                Current.todayClicks = 0;
            }
        }

        public string SerializeConfig()
        {
            EnsureTodayDate();
            return _json.Serialize(Current);
        }

        public bool ApplyPatch(Dictionary<string, object> patch, bool saveNow = true)
        {
            if (patch == null) return false;
            bool changed = false;

            if (TryGetString(patch, "avatar", ref Current.avatar)) changed = true;
            if (TryGetString(patch, "vrmCamera", ref Current.vrmCamera)) changed = true;
            if (TryGetString(patch, "vrmaUrl", ref Current.vrmaUrl)) changed = true;
            if (TryGetString(patch, "avatarVariant", ref Current.avatarVariant)) changed = true;
            if (TryGetString(patch, "shader3d", ref Current.shader3d)) changed = true;
            if (TryGetString(patch, "keyboard", ref Current.keyboard)) changed = true;
            if (TryGetString(patch, "mouseGear", ref Current.mouseGear)) changed = true;
            if (TryGetString(patch, "deskMat", ref Current.deskMat)) changed = true;
            if (TryGetString(patch, "palette", ref Current.palette)) changed = true;
            if (TryGetString(patch, "dockMode", ref Current.dockMode)) changed = true;
            if (TryGetString(patch, "soundPack", ref Current.soundPack)) changed = true;
            if (TryGetString(patch, "studioTheme", ref Current.studioTheme)) changed = true;

            if (TryGetDouble(patch, "scale", ref Current.scale, 0.55, 1.85)) changed = true;
            if (TryGetDouble(patch, "soundVolume", ref Current.soundVolume, 0.0, 1.0)) changed = true;
            if (TryGetDouble(patch, "customEyeX", ref Current.customEyeX, 0.15, 0.85)) changed = true;
            if (TryGetDouble(patch, "customEyeY", ref Current.customEyeY, 0.10, 0.85)) changed = true;
            if (TryGetDouble(patch, "customScale", ref Current.customScale, 0.4, 2.2)) changed = true;
            if (TryGetDouble(patch, "customOffsetY", ref Current.customOffsetY, -120, 120)) changed = true;

            if (TryGetBool(patch, "clickThrough", ref Current.clickThrough)) changed = true;
            if (TryGetBool(patch, "topMost", ref Current.topMost)) changed = true;
            if (TryGetBool(patch, "pauseOnFullscreen", ref Current.pauseOnFullscreen)) changed = true;
            if (TryGetBool(patch, "autoStart", ref Current.autoStart))
            {
                if (!SyncAutoStartRegistry(Current.autoStart))
                {
                    Current.autoStart = ReadAutoStartRegistry();
                }
                changed = true;
            }
            if (TryGetBool(patch, "eyeTrackCursor", ref Current.eyeTrackCursor)) changed = true;
            if (TryGetBool(patch, "eyeProximityFX", ref Current.eyeProximityFX)) changed = true;
            if (TryGetBool(patch, "petting", ref Current.petting)) changed = true;
            if (TryGetBool(patch, "appContextAuto", ref Current.appContextAuto)) changed = true;
            if (TryGetBool(patch, "audioReactive", ref Current.audioReactive)) changed = true;
            if (TryGetBool(patch, "shortcutMemes", ref Current.shortcutMemes)) changed = true;
            if (TryGetBool(patch, "ambientFusion", ref Current.ambientFusion)) changed = true;
            if (TryGetBool(patch, "sound", ref Current.sound)) changed = true;
            if (TryGetBool(patch, "propCoffee", ref Current.propCoffee)) changed = true;
            if (TryGetBool(patch, "propHeadphones", ref Current.propHeadphones)) changed = true;
            if (TryGetBool(patch, "propLedStrip", ref Current.propLedStrip)) changed = true;
            if (TryGetBool(patch, "showMiniCounter", ref Current.showMiniCounter)) changed = true;

            // Update calibration on matching custom asset if active
            if (Current.avatar != null && Current.avatar.StartsWith("custom:"))
            {
                string cid = Current.avatar.Substring("custom:".Length);
                foreach (CustomAssetEntry a in Current.customAssets)
                {
                    if (a.id == cid)
                    {
                        a.eyeAnchorX = Current.customEyeX;
                        a.eyeAnchorY = Current.customEyeY;
                        a.scale = Current.customScale;
                        a.offsetY = Current.customOffsetY;
                        break;
                    }
                }
            }

            if (changed && saveNow) Save();
            return changed;
        }

        private static bool TryGetString(Dictionary<string, object> dict, string key, ref string target)
        {
            object val;
            if (!dict.TryGetValue(key, out val) || val == null) return false;
            string s = Convert.ToString(val);
            if (s == target) return false;
            target = s;
            return true;
        }

        private static bool TryGetBool(Dictionary<string, object> dict, string key, ref bool target)
        {
            object val;
            if (!dict.TryGetValue(key, out val) || val == null) return false;
            bool b = Convert.ToBoolean(val);
            if (b == target) return false;
            target = b;
            return true;
        }

        private static bool TryGetDouble(Dictionary<string, object> dict, string key, ref double target, double min, double max)
        {
            object val;
            if (!dict.TryGetValue(key, out val) || val == null) return false;
            double d = Convert.ToDouble(val, System.Globalization.CultureInfo.InvariantCulture);
            if (d < min) d = min;
            if (d > max) d = max;
            if (Math.Abs(d - target) < 0.0001) return false;
            target = d;
            return true;
        }
    }
}
