using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KuroDesk
{
    /// <summary>
    /// Open Asset Workshop manager.
    /// Allows users to import local 2.5D anime illustrations/layered packs (PNG/SVG/manifest),
    /// 3D VRM/GLB models, Live2D (.model3.json) packages, and custom mechanical keyboard .wav sounds
    /// into %APPDATA%\KuroDesk\assets\ and exposes them over https://kuro-assets.local/.
    /// Strictly copies ONLY explicitly referenced files for JSON/Live2D packages (never copies unrelated user folders).
    /// </summary>
    internal sealed class AssetManager
    {
        private readonly ConfigStore _store;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public AssetManager(ConfigStore store)
        {
            _store = store;
        }

        public CustomAssetEntry ImportViaDialog(IWin32Window owner, string kindHint, out string errorMsg)
        {
            errorMsg = null;
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.CheckFileExists = true;
                dlg.Multiselect = false;

                if (kindHint == "avatar3d")
                {
                    dlg.Title = "导入 3D 动漫角色 / 手办模型 (.vrm / .glb)";
                    dlg.Filter = "3D 模型 (*.vrm;*.glb)|*.vrm;*.glb|所有文件 (*.*)|*.*";
                }
                else if (kindHint == "avatar25d")
                {
                    dlg.Title = "导入 2.5D 动漫立绘或分件包 (.png / .webp / .svg / pack.json)";
                    dlg.Filter = "2.5D 角色资产 (*.png;*.webp;*.svg;*.json)|*.png;*.webp;*.svg;*.json|所有文件 (*.*)|*.*";
                }
                else if (kindHint == "live2d")
                {
                    dlg.Title = "导入 Live2D / BongoCat 模型包 (*.model3.json / *.zip)";
                    dlg.Filter = "Live2D 模型包 (*.zip;*.model3.json)|*.zip;*.model3.json|JSON (*.json)|*.json";
                }
                else if (kindHint == "zip")
                {
                    dlg.Title = "一键导入社区模型压缩包 (.zip：Live2D / BongoCat / VRM / 2.5D分件)";
                    dlg.Filter = "模型压缩包 (*.zip)|*.zip|所有支持格式 (*.zip;*.vrm;*.glb;*.model3.json;*.png)|*.zip;*.vrm;*.glb;*.model3.json;*.png";
                }
                else if (kindHint == "vrma")
                {
                    dlg.Title = "导入 VRM 3D 动作文件 (.vrma)";
                    dlg.Filter = "VRM 动作 (*.vrma)|*.vrma|所有文件 (*.*)|*.*";
                }
                else if (kindHint == "soundpack")
                {
                    dlg.Title = "导入自定义机械键盘敲击音效 (.wav / .mp3 / .ogg)";
                    dlg.Filter = "音频文件 (*.wav;*.mp3;*.ogg)|*.wav;*.mp3;*.ogg";
                }
                else
                {
                    dlg.Title = "导入自定义角色、3D 模型、Live2D/BongoCat 包或动作音效";
                    dlg.Filter = "全部支持格式 (*.zip;*.vrm;*.glb;*.vrma;*.png;*.webp;*.svg;*.json;*.wav;*.mp3;*.ogg)|*.zip;*.vrm;*.glb;*.vrma;*.png;*.webp;*.svg;*.json;*.wav;*.mp3;*.ogg";
                }

                if (dlg.ShowDialog(owner) != DialogResult.OK)
                {
                    return null;
                }

                return ImportFile(dlg.FileName, kindHint, out errorMsg);
            }
        }

        public bool ImportCubismCoreViaDialog(IWin32Window owner, out string errorMsg)
        {
            errorMsg = null;
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.CheckFileExists = true;
                dlg.Multiselect = false;
                dlg.Title = "选择 Live2D Cubism Web Core 运行时 (live2dcubismcore.min.js)";
                dlg.Filter = "Cubism Core JS (live2dcubismcore*.js)|live2dcubismcore*.js|JavaScript (*.js)|*.js";
                if (dlg.ShowDialog(owner) != DialogResult.OK) return false;
                return InstallCubismCoreFromPath(dlg.FileName, out errorMsg);
            }
        }

        public bool InstallCubismCoreFromPath(string sourcePath, out string errorMsg)
        {
            errorMsg = null;
            try
            {
                if (string.IsNullOrEmpty(sourcePath) || !File.Exists(sourcePath))
                {
                    errorMsg = "文件不存在：" + sourcePath;
                    return false;
                }
                FileInfo fi = new FileInfo(sourcePath);
                if (fi.Length < 4096 || fi.Length > 10L * 1024 * 1024)
                {
                    errorMsg = "文件大小异常，请确认选择的是官方 Live2D Cubism SDK for Web 中的 live2dcubismcore.min.js。";
                    return false;
                }
                string dst = _store.CubismCorePath;
                Directory.CreateDirectory(Path.GetDirectoryName(dst));
                File.Copy(sourcePath, dst, true);
                _store.RefreshRuntimeFlags();
                _store.Save();
                return true;
            }
            catch (Exception ex)
            {
                errorMsg = "安装运行时失败：" + ex.Message;
                return false;
            }
        }

        public CustomAssetEntry ImportFile(string sourceFile, string kindHint, out string errorMsg)
        {
            errorMsg = null;
            try
            {
                if (!File.Exists(sourceFile))
                {
                    errorMsg = "所选文件不存在。";
                    return null;
                }

                string ext = Path.GetExtension(sourceFile).ToLowerInvariant();
                if (ext == ".zip")
                {
                    return ImportZipArchive(sourceFile, out errorMsg);
                }

                string fileName = Path.GetFileName(sourceFile);
                string baseName = Path.GetFileNameWithoutExtension(sourceFile);
                if (fileName.EndsWith(".model3.json", StringComparison.OrdinalIgnoreCase))
                {
                    baseName = fileName.Substring(0, fileName.Length - ".model3.json".Length);
                }

                string detectedKind = kindHint;
                if (ext == ".vrm" || ext == ".glb") detectedKind = "avatar3d";
                else if (ext == ".vrma") detectedKind = "vrma";
                else if (ext == ".png" || ext == ".webp" || ext == ".svg") detectedKind = "avatar25d";
                else if (fileName.EndsWith(".model3.json", StringComparison.OrdinalIgnoreCase)) detectedKind = "live2d";
                else if (ext == ".wav" || ext == ".mp3" || ext == ".ogg") detectedKind = "soundpack";
                else if (ext == ".json") detectedKind = "avatar25d";

                FileInfo srcFi = new FileInfo(sourceFile);
                long maxSingleBytes = detectedKind == "avatar3d" ? (120L * 1024 * 1024) : (30L * 1024 * 1024);
                if (srcFi.Length > maxSingleBytes)
                {
                    errorMsg = "文件过大，超过大小限制（" + (maxSingleBytes / (1024 * 1024)) + " MB）。";
                    return null;
                }

                string id = "asset_" + DateTime.Now.ToString("yyyyMMddHHmmss") + "_" + (Guid.NewGuid().ToString("N").Substring(0, 5));
                string destDir = Path.Combine(_store.AssetsFolder, id);
                Directory.CreateDirectory(destDir);

                string entryFileName = fileName;
                string previewRel = null;
                string bongoRel = null;
                string notes = "";

                if (detectedKind == "live2d" || (detectedKind == "avatar25d" && ext == ".json"))
                {
                    string srcDir = Path.GetDirectoryName(sourceFile);
                    File.Copy(sourceFile, Path.Combine(destDir, entryFileName), true);

                    List<string> refs = ExtractReferencedAssetsFromJson(sourceFile, out previewRel);
                    long copied = srcFi.Length;
                    foreach (string relPath in refs)
                    {
                        copied = CopyRelativeSafe(srcDir, destDir, relPath, copied, 90L * 1024 * 1024);
                    }

                    if (detectedKind == "live2d")
                    {
                        // Also copy sibling BongoCat resources/ (background.png, cover.png, left-keys/, right-keys/) if unzipped folder
                        string bongoResDir = Path.Combine(srcDir, "resources");
                        if (Directory.Exists(bongoResDir))
                        {
                            string fullSrcRoot = Path.GetFullPath(srcDir).TrimEnd('\\') + "\\";
                            foreach (string rf in Directory.GetFiles(bongoResDir, "*", SearchOption.AllDirectories))
                            {
                                string rlow = rf.ToLowerInvariant();
                                if (rlow.EndsWith(".png") || rlow.EndsWith(".webp") || rlow.EndsWith(".jpg"))
                                {
                                    copied = CopyRelativeSafe(srcDir, destDir, rf.Substring(fullSrcRoot.Length), copied, 90L * 1024 * 1024);
                                }
                            }
                            string fullDestRoot = Path.GetFullPath(destDir).TrimEnd('\\') + "\\";
                            string coverRel;
                            bongoRel = TryBuildBongoCatManifest(id, destDir, fullDestRoot, Path.Combine(destDir, entryFileName), Directory.GetFiles(destDir, "*", SearchOption.AllDirectories), out coverRel);
                            if (!string.IsNullOrEmpty(coverRel)) previewRel = coverRel;
                        }

                        bool isBongo = !string.IsNullOrEmpty(bongoRel);
                        notes = _store.Current.hasCubismCore
                            ? (isBongo ? "BongoCat Live2D 桌宠包（逐键手部与骨骼物理已就绪）" : "Live2D Model3（完整蒙版、物理与表情动作已就绪）")
                            : (isBongo ? "BongoCat Live2D 桌宠包（导入 Cubism Core 后激活完整骨骼）" : "Live2D Model3（已提取贴图预览；导入 Cubism Core 后驱动完整骨骼）");
                    }
                    else
                    {
                        notes = "2.5D 分件立绘包（原生视差与眼动）";
                    }
                }
                else
                {
                    string destFile = Path.Combine(destDir, entryFileName);
                    File.Copy(sourceFile, destFile, true);
                    if (detectedKind == "avatar3d")
                    {
                        previewRel = TryExtractVrmThumbnail(destFile, destDir);
                        notes = ext == ".vrm" ? "VRM 3D 动漫角色（Three.js MToon + 头发物理 + 表情）" : "GLB 3D 模型（Three.js 渲染）";
                    }
                    else if (detectedKind == "vrma") notes = "VRM 3D 扩展动作包 (.vrma)";
                    else if (detectedKind == "avatar25d") notes = "2.5D 透明立绘（支持弹性物理 + 缩放校准）";
                    else if (detectedKind == "soundpack") notes = "自定义实录机械轴音效";
                }

                CustomAssetEntry entry = new CustomAssetEntry();
                entry.id = id;
                entry.name = baseName;
                entry.kind = detectedKind;
                entry.folderName = id;
                entry.entryUrl = BuildVirtualUrl(id, entryFileName);
                entry.previewUrl = !string.IsNullOrEmpty(previewRel) ? BuildVirtualUrl(id, previewRel) : "";
                entry.bongoManifestUrl = !string.IsNullOrEmpty(bongoRel) ? BuildVirtualUrl(id, bongoRel) : "";
                entry.eyeAnchorX = 0.48;
                entry.eyeAnchorY = 0.34;
                entry.scale = 1.0;
                entry.offsetY = 0.0;
                entry.notes = notes;

                _store.Current.customAssets.Add(entry);
                if (detectedKind == "soundpack")
                {
                    _store.Current.soundPack = "custom:" + id;
                }
                else if (detectedKind == "vrma")
                {
                    _store.Current.vrmaUrl = entry.entryUrl;
                }
                else
                {
                    _store.Current.avatar = "custom:" + id;
                    _store.Current.customEyeX = entry.eyeAnchorX;
                    _store.Current.customEyeY = entry.eyeAnchorY;
                    _store.Current.customScale = entry.scale;
                    _store.Current.customOffsetY = entry.offsetY;
                }
                _store.Save();
                return entry;
            }
            catch (Exception ex)
            {
                errorMsg = "导入失败：" + ex.Message;
                return null;
            }
        }

        private CustomAssetEntry ImportZipArchive(string zipPath, out string errorMsg)
        {
            errorMsg = null;
            string id = "asset_" + DateTime.Now.ToString("yyyyMMddHHmmss") + "_" + (Guid.NewGuid().ToString("N").Substring(0, 5));
            string destDir = Path.Combine(_store.AssetsFolder, id);
            Directory.CreateDirectory(destDir);

            try
            {
                string fullDestRoot = Path.GetFullPath(destDir).TrimEnd('\\') + "\\";
                long totalExtracted = 0;
                const long MaxTotalBytes = 120L * 1024 * 1024;
                int fileCount = 0;

                using (ZipArchive archive = ZipFile.OpenRead(zipPath))
                {
                    foreach (ZipArchiveEntry ze in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(ze.Name)) continue;
                        fileCount++;
                        if (fileCount > 1200) throw new InvalidOperationException("压缩包内文件过多（上限 1200 个）。");
                        totalExtracted += ze.Length;
                        if (totalExtracted > MaxTotalBytes) throw new InvalidOperationException("解压总体积超过 120MB 安全上限。");

                        string targetPath = Path.GetFullPath(Path.Combine(destDir, ze.FullName.Replace('/', '\\')));
                        if (!targetPath.StartsWith(fullDestRoot, StringComparison.OrdinalIgnoreCase)) continue;

                        Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
                        using (Stream src = ze.Open())
                        using (FileStream dst = File.Create(targetPath))
                        {
                            src.CopyTo(dst);
                        }
                    }
                }

                string[] allFiles = Directory.GetFiles(destDir, "*", SearchOption.AllDirectories);
                string model3 = null, vrmFile = null, packJson = null, bestImg = null;
                long bestImgLen = 0;

                foreach (string f in allFiles)
                {
                    string low = f.ToLowerInvariant();
                    if (low.EndsWith(".model3.json") && model3 == null) model3 = f;
                    else if ((low.EndsWith(".vrm") || low.EndsWith(".glb")) && vrmFile == null) vrmFile = f;
                    else if (Path.GetFileName(low) == "pack.json" && packJson == null) packJson = f;
                    else if (low.EndsWith(".png") || low.EndsWith(".webp"))
                    {
                        long len = new FileInfo(f).Length;
                        if (len > bestImgLen) { bestImgLen = len; bestImg = f; }
                    }
                }

                string detectedKind, entryAbs, previewRel = null, bongoRel = null, notes;
                if (model3 != null)
                {
                    detectedKind = "live2d";
                    entryAbs = model3;

                    // Detect & build BongoCat or BongoCatMver composite layer manifest (background + per-key hands/keycaps!)
                    string coverRel;
                    bongoRel = TryBuildBongoCatManifest(id, destDir, fullDestRoot, model3, allFiles, out coverRel);
                    if (!string.IsNullOrEmpty(coverRel))
                    {
                        previewRel = coverRel;
                    }
                    else
                    {
                        string relImg;
                        ExtractReferencedAssetsFromJson(model3, out relImg);
                        if (!string.IsNullOrEmpty(relImg))
                        {
                            string imgAbs = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(model3), relImg.Replace('/', '\\')));
                            if (imgAbs.StartsWith(fullDestRoot, StringComparison.OrdinalIgnoreCase) && File.Exists(imgAbs))
                                previewRel = imgAbs.Substring(fullDestRoot.Length);
                        }
                    }

                    bool isBongo = !string.IsNullOrEmpty(bongoRel);
                    notes = _store.Current.hasCubismCore
                        ? (isBongo ? "BongoCat Live2D 桌宠包（逐键手部与骨骼物理已就绪）" : "Live2D Model3（完整蒙版、物理与表情动作已就绪）")
                        : (isBongo ? "BongoCat Live2D 桌宠包（导入 Cubism Core 后激活完整骨骼）" : "Live2D Model3（导入 Cubism Core 后激活完整骨骼）");
                }
                else if (vrmFile != null)
                {
                    detectedKind = "avatar3d";
                    entryAbs = vrmFile;
                    previewRel = TryExtractVrmThumbnail(vrmFile, destDir);
                    notes = vrmFile.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase)
                        ? "VRM 3D 动漫角色包（Three.js MToon + 头发物理 + 表情）"
                        : "GLB 3D 模型包（Three.js 渲染）";
                }
                else if (packJson != null)
                {
                    detectedKind = "avatar25d";
                    entryAbs = packJson;
                    notes = "2.5D 分件立绘包（原生视差与动态五官）";
                }
                else if (bestImg != null)
                {
                    detectedKind = "avatar25d";
                    entryAbs = bestImg;
                    notes = "2.5D 透明立绘（来自 ZIP 包）";
                }
                else
                {
                    throw new InvalidOperationException("未在压缩包内找到 .model3.json、.vrm、.glb、pack.json 或 PNG 贴图。");
                }

                string entryRel = entryAbs.Substring(fullDestRoot.Length);
                CustomAssetEntry entry = new CustomAssetEntry();
                entry.id = id;
                entry.name = Path.GetFileNameWithoutExtension(zipPath);
                entry.kind = detectedKind;
                entry.folderName = id;
                entry.entryUrl = BuildVirtualUrl(id, entryRel);
                entry.previewUrl = !string.IsNullOrEmpty(previewRel) ? BuildVirtualUrl(id, previewRel) : "";
                entry.bongoManifestUrl = !string.IsNullOrEmpty(bongoRel) ? BuildVirtualUrl(id, bongoRel) : "";
                entry.eyeAnchorX = 0.48;
                entry.eyeAnchorY = 0.34;
                entry.scale = 1.0;
                entry.offsetY = 0.0;
                entry.notes = notes;

                _store.Current.customAssets.Add(entry);
                _store.Current.avatar = "custom:" + id;
                _store.Current.customEyeX = entry.eyeAnchorX;
                _store.Current.customEyeY = entry.eyeAnchorY;
                _store.Current.customScale = entry.scale;
                _store.Current.customOffsetY = entry.offsetY;
                _store.Save();
                return entry;
            }
            catch (Exception ex)
            {
                try { if (Directory.Exists(destDir)) Directory.Delete(destDir, true); } catch { }
                errorMsg = "ZIP 模型包导入失败：" + ex.Message;
                return null;
            }
        }

        public bool DeleteAsset(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            List<CustomAssetEntry> list = _store.Current.customAssets;
            CustomAssetEntry found = null;
            foreach (CustomAssetEntry a in list)
            {
                if (a.id == id) { found = a; break; }
            }
            if (found == null) return false;

            list.Remove(found);
            if (_store.Current.avatar == "custom:" + id)
            {
                _store.Current.avatar = "vrm-sample-a";
                _store.Current.avatarVariant = "";
            }
            if (_store.Current.soundPack == "custom:" + id)
            {
                _store.Current.soundPack = "creamy-thock";
            }
            if (_store.Current.vrmaUrl == found.entryUrl)
            {
                _store.Current.vrmaUrl = "";
            }
            _store.Save();

            try
            {
                string dir = Path.Combine(_store.AssetsFolder, found.folderName);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            catch { }
            return true;
        }

        private static string BuildVirtualUrl(string id, string relPath)
        {
            string norm = relPath.Replace('\\', '/').TrimStart('/');
            string[] segs = norm.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < segs.Length; i++) segs[i] = Uri.EscapeDataString(segs[i]);
            return "https://kuro-assets.local/" + id + "/" + string.Join("/", segs);
        }

        private List<string> ExtractReferencedAssetsFromJson(string jsonFile, out string previewRel)
        {
            previewRel = null;
            List<string> results = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                string raw = File.ReadAllText(jsonFile);
                object root = _json.DeserializeObject(raw);
                string firstImg = null;
                CollectAssetPaths(root, results, seen, ref firstImg);
                previewRel = firstImg;
            }
            catch { }
            return results;
        }

        private static void CollectAssetPaths(object node, List<string> outPaths, HashSet<string> seen, ref string firstImage)
        {
            if (node == null) return;
            string s = node as string;
            if (s != null)
            {
                string low = s.ToLowerInvariant();
                if (low.EndsWith(".png") || low.EndsWith(".webp") || low.EndsWith(".jpg") || low.EndsWith(".jpeg") || low.EndsWith(".svg"))
                {
                    if (firstImage == null) firstImage = s;
                    if (seen.Add(s)) outPaths.Add(s);
                }
                else if (low.EndsWith(".moc3") || low.EndsWith(".physics3.json") || low.EndsWith(".pose3.json")
                    || low.EndsWith(".cdi3.json") || low.EndsWith(".exp3.json") || low.EndsWith(".motion3.json")
                    || low.EndsWith(".userdata3.json"))
                {
                    if (seen.Add(s)) outPaths.Add(s);
                }
                return;
            }

            Dictionary<string, object> dict = node as Dictionary<string, object>;
            if (dict != null)
            {
                foreach (KeyValuePair<string, object> kv in dict)
                {
                    CollectAssetPaths(kv.Value, outPaths, seen, ref firstImage);
                }
                return;
            }

            IEnumerable arr = node as IEnumerable;
            if (arr != null)
            {
                foreach (object item in arr)
                {
                    CollectAssetPaths(item, outPaths, seen, ref firstImage);
                }
            }
        }

        /// <summary>
        /// Extracts embedded VRM 0.x (meta.texture) or VRM 1.0 (meta.thumbnailImage) portrait PNG/JPG directly from GLB binary!
        /// </summary>
        private string TryExtractVrmThumbnail(string vrmPath, string destDir)
        {
            try
            {
                using (FileStream fs = File.OpenRead(vrmPath))
                using (BinaryReader br = new BinaryReader(fs))
                {
                    if (fs.Length < 20 || br.ReadUInt32() != 0x46546C67u) return null; // "glTF"
                    br.ReadUInt32(); // version
                    br.ReadUInt32(); // total length

                    string jsonStr = null;
                    long binOffset = -1;
                    long binLen = 0;

                    while (fs.Position + 8 <= fs.Length)
                    {
                        uint chunkLen = br.ReadUInt32();
                        uint chunkType = br.ReadUInt32();
                        long dataStart = fs.Position;
                        if (chunkType == 0x4E4F534Au)
                        {
                            byte[] jb = br.ReadBytes((int)chunkLen);
                            jsonStr = System.Text.Encoding.UTF8.GetString(jb);
                        }
                        else if (chunkType == 0x004E4942u)
                        {
                            binOffset = dataStart;
                            binLen = chunkLen;
                            break;
                        }
                        fs.Position = dataStart + chunkLen;
                    }

                    if (string.IsNullOrEmpty(jsonStr) || binOffset < 0) return null;
                    _json.MaxJsonLength = Math.Max(_json.MaxJsonLength, jsonStr.Length + 65536);
                    Dictionary<string, object> gltf = _json.Deserialize<Dictionary<string, object>>(jsonStr);
                    if (gltf == null || !gltf.ContainsKey("extensions")) return null;

                    int imgIdx = -1;
                    Dictionary<string, object> exts = gltf["extensions"] as Dictionary<string, object>;
                    if (exts != null && exts.ContainsKey("VRMC_vrm"))
                    {
                        Dictionary<string, object> v1 = exts["VRMC_vrm"] as Dictionary<string, object>;
                        Dictionary<string, object> meta = v1 != null && v1.ContainsKey("meta") ? v1["meta"] as Dictionary<string, object> : null;
                        if (meta != null && meta.ContainsKey("thumbnailImage")) imgIdx = Convert.ToInt32(meta["thumbnailImage"]);
                    }
                    if (imgIdx < 0 && exts != null && exts.ContainsKey("VRM"))
                    {
                        Dictionary<string, object> v0 = exts["VRM"] as Dictionary<string, object>;
                        Dictionary<string, object> meta = v0 != null && v0.ContainsKey("meta") ? v0["meta"] as Dictionary<string, object> : null;
                        if (meta != null && meta.ContainsKey("texture"))
                        {
                            int texIdx = Convert.ToInt32(meta["texture"]);
                            object[] texArr = gltf.ContainsKey("textures") ? gltf["textures"] as object[] : null;
                            if (texArr != null && texIdx >= 0 && texIdx < texArr.Length)
                            {
                                Dictionary<string, object> texObj = texArr[texIdx] as Dictionary<string, object>;
                                if (texObj != null && texObj.ContainsKey("source")) imgIdx = Convert.ToInt32(texObj["source"]);
                            }
                        }
                    }

                    object[] images = gltf.ContainsKey("images") ? gltf["images"] as object[] : null;
                    object[] bvs = gltf.ContainsKey("bufferViews") ? gltf["bufferViews"] as object[] : null;
                    if (imgIdx < 0 || images == null || bvs == null || imgIdx >= images.Length) return null;

                    Dictionary<string, object> imgDef = images[imgIdx] as Dictionary<string, object>;
                    if (imgDef == null || !imgDef.ContainsKey("bufferView")) return null;
                    int bvIdx = Convert.ToInt32(imgDef["bufferView"]);
                    if (bvIdx < 0 || bvIdx >= bvs.Length) return null;

                    Dictionary<string, object> bv = bvs[bvIdx] as Dictionary<string, object>;
                    long bo = bv != null && bv.ContainsKey("byteOffset") ? Convert.ToInt64(bv["byteOffset"]) : 0;
                    int bl = bv != null && bv.ContainsKey("byteLength") ? Convert.ToInt32(bv["byteLength"]) : 0;
                    if (bl <= 0 || bo + bl > binLen) return null;

                    string mime = imgDef.ContainsKey("mimeType") ? Convert.ToString(imgDef["mimeType"]) : "image/png";
                    string ext = mime.IndexOf("jpeg", StringComparison.OrdinalIgnoreCase) >= 0 ? ".jpg" : ".png";
                    string thumbName = "kuro_thumb" + ext;

                    fs.Position = binOffset + bo;
                    byte[] imgBytes = br.ReadBytes(bl);
                    File.WriteAllBytes(Path.Combine(destDir, thumbName), imgBytes);
                    return thumbName;
                }
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Builds kuro_bongocat.json for BOTH modern BongoCat packs (resources/background.png + left-keys/ + right-keys/)
        /// AND legacy BongoCatMver packs (config.json + img/<mode>/hand/ + keyboard/ + mousebg.png/bg.png).
        /// </summary>
        private string TryBuildBongoCatManifest(string assetId, string destDir, string fullDestRoot, string model3Abs, string[] allFiles, out string coverRel)
        {
            coverRel = null;
            try
            {
                string bgAbs = null;
                string coverAbs = null;
                Dictionary<string, string> leftKeys = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, string> rightKeys = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, string> mverKb = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, string> mverHand = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string configJsonAbs = null;

                foreach (string f in allFiles)
                {
                    string rel = f.Substring(fullDestRoot.Length).Replace('\\', '/');
                    string low = rel.ToLowerInvariant();
                    string fn = Path.GetFileName(low);

                    if (fn == "config.json" && configJsonAbs == null) configJsonAbs = f;
                    if (fn == "background.png" || fn == "mousebg.png" || fn == "bg.png")
                    {
                        if (bgAbs == null || fn == "background.png") bgAbs = f;
                    }
                    if (fn == "cover.png" || fn == "cat.png")
                    {
                        if (coverAbs == null || fn == "cover.png") coverAbs = f;
                    }

                    if (low.Contains("/left-keys/") || low.StartsWith("left-keys/"))
                    {
                        if (low.EndsWith(".png") || low.EndsWith(".webp"))
                        {
                            string kName = Path.GetFileNameWithoutExtension(f);
                            leftKeys[kName] = BuildVirtualUrl(assetId, rel);
                        }
                    }
                    else if (low.Contains("/right-keys/") || low.StartsWith("right-keys/"))
                    {
                        if (low.EndsWith(".png") || low.EndsWith(".webp"))
                        {
                            string kName = Path.GetFileNameWithoutExtension(f);
                            rightKeys[kName] = BuildVirtualUrl(assetId, rel);
                        }
                    }
                }

                // Legacy BongoCatMver config.json key mapping (VK -> keyboard/<idx>.png & hand/<idx>.png)
                if (configJsonAbs != null && leftKeys.Count == 0 && rightKeys.Count == 0)
                {
                    string modeDir = Path.GetDirectoryName(Path.GetDirectoryName(model3Abs));
                    if (!string.IsNullOrEmpty(modeDir) && Directory.Exists(modeDir))
                    {
                        string kbDir = Path.Combine(modeDir, "keyboard");
                        string handDir = Path.Combine(modeDir, "hand");
                        if (!Directory.Exists(handDir)) handDir = Path.Combine(modeDir, "lefthand");

                        try
                        {
                            string rawCfg = File.ReadAllText(configJsonAbs);
                            Dictionary<string, object> cfgObj = _json.Deserialize<Dictionary<string, object>>(rawCfg);
                            string modeName = Path.GetFileName(modeDir).ToLowerInvariant();
                            Dictionary<string, object> sec = (cfgObj != null && cfgObj.ContainsKey(modeName))
                                ? cfgObj[modeName] as Dictionary<string, object>
                                : (cfgObj != null && cfgObj.ContainsKey("standard") ? cfgObj["standard"] as Dictionary<string, object> : null);
                            if (sec != null)
                            {
                                MapMverVkList(sec, "keyboard", kbDir, assetId, fullDestRoot, mverKb);
                                MapMverVkList(sec, "hand", handDir, assetId, fullDestRoot, mverHand);
                                MapMverVkList(sec, "lefthand", handDir, assetId, fullDestRoot, mverHand);
                            }
                        }
                        catch { }
                    }
                }

                if (coverAbs != null) coverRel = coverAbs.Substring(fullDestRoot.Length);
                if (bgAbs == null && leftKeys.Count == 0 && rightKeys.Count == 0 && mverKb.Count == 0 && mverHand.Count == 0)
                {
                    return null;
                }

                Dictionary<string, object> manifest = new Dictionary<string, object>();
                manifest["backgroundUrl"] = bgAbs != null ? BuildVirtualUrl(assetId, bgAbs.Substring(fullDestRoot.Length)) : "";
                manifest["coverUrl"] = coverRel != null ? BuildVirtualUrl(assetId, coverRel) : "";
                manifest["leftKeys"] = leftKeys;
                manifest["rightKeys"] = rightKeys;
                manifest["mverKeyboard"] = mverKb;
                manifest["mverHand"] = mverHand;

                string mFile = Path.Combine(Path.GetDirectoryName(model3Abs), "kuro_bongocat.json");
                File.WriteAllText(mFile, _json.Serialize(manifest));
                return mFile.Substring(fullDestRoot.Length);
            }
            catch
            {
                return null;
            }
        }

        private static void MapMverVkList(Dictionary<string, object> sec, string prop, string imgDir, string assetId, string fullDestRoot, Dictionary<string, string> target)
        {
            if (!sec.ContainsKey(prop) || !Directory.Exists(imgDir)) return;
            object[] groups = sec[prop] as object[];
            if (groups == null) return;
            for (int i = 0; i < groups.Length; i++)
            {
                string png = Path.Combine(imgDir, i + ".png");
                if (!File.Exists(png)) continue;
                string url = BuildVirtualUrl(assetId, png.Substring(fullDestRoot.Length));
                object[] vks = groups[i] as object[];
                if (vks == null) continue;
                foreach (object vo in vks)
                {
                    int vk = Convert.ToInt32(vo);
                    string kName = VkToCanonicalKeyName(vk);
                    if (!string.IsNullOrEmpty(kName) && !target.ContainsKey(kName))
                    {
                        target[kName] = url;
                    }
                }
            }
        }

        private static string VkToCanonicalKeyName(int vk)
        {
            if (vk >= 0x41 && vk <= 0x5A) return "Key" + (char)vk;
            if (vk >= 0x30 && vk <= 0x39) return "Digit" + (char)vk;
            if (vk >= 0x70 && vk <= 0x7B) return "F" + (vk - 0x6F);
            switch (vk)
            {
                case 0x20: return "Space";
                case 0x0D: return "Enter";
                case 0x09: return "Tab";
                case 0x08: return "Backspace";
                case 0x1B: return "Escape";
                case 0x14: return "CapsLock";
                case 0xA0: case 0x10: return "ShiftLeft";
                case 0xA1: return "ShiftRight";
                case 0xA2: case 0x11: return "ControlLeft";
                case 0xA3: return "ControlRight";
                case 0xA4: case 0x12: return "AltLeft";
                case 0xA5: return "AltRight";
                case 0x25: return "ArrowLeft";
                case 0x26: return "ArrowUp";
                case 0x27: return "ArrowRight";
                case 0x28: return "ArrowDown";
                default: return "VK_" + vk;
            }
        }

        private static long CopyRelativeSafe(string srcRoot, string dstRoot, string relPath, long copiedBytes, long maxBytes)
        {
            if (string.IsNullOrEmpty(relPath) || Path.IsPathRooted(relPath)) return copiedBytes;
            string fullSrcRoot = Path.GetFullPath(srcRoot).TrimEnd('\\') + "\\";
            string fullSrc = Path.GetFullPath(Path.Combine(srcRoot, relPath.Replace('/', '\\')));
            if (!fullSrc.StartsWith(fullSrcRoot, StringComparison.OrdinalIgnoreCase)) return copiedBytes; // Block path traversal
            if (!File.Exists(fullSrc)) return copiedBytes;

            FileInfo fi = new FileInfo(fullSrc);
            if (copiedBytes + fi.Length > maxBytes) return copiedBytes;

            string relClean = fullSrc.Substring(fullSrcRoot.Length);
            string fullDst = Path.Combine(dstRoot, relClean);
            Directory.CreateDirectory(Path.GetDirectoryName(fullDst));
            File.Copy(fullSrc, fullDst, true);
            return copiedBytes + fi.Length;
        }
    }
}
