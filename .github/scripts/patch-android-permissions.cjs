const fs = require('fs');
const path = require('path');

// 1. Patch AndroidManifest.xml with CAMERA & FLASHLIGHT permissions
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  const declarations = [
    { key: 'android.permission.CAMERA', tag: '<uses-permission android:name="android.permission.CAMERA" />' },
    { key: 'android.permission.FLASHLIGHT', tag: '<uses-permission android:name="android.permission.FLASHLIGHT" />' },
    { key: 'android.hardware.camera', tag: '<uses-feature android:name="android.hardware.camera" android:required="false" />' },
    { key: 'android.hardware.camera.autofocus', tag: '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />' },
  ];

  const missingTags = declarations
    .filter((d) => !manifest.includes(`"${d.key}"`))
    .map((d) => d.tag);

  if (missingTags.length > 0) {
    manifest = manifest.replace(
      /<application\b/,
      missingTags.join('\n    ') + '\n\n    <application'
    );
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    console.log('Patched AndroidManifest.xml with CAMERA permissions.');
  } else {
    console.log('AndroidManifest.xml already contains CAMERA permissions.');
  }
} else {
  console.warn('Warning: AndroidManifest.xml not found at', manifestPath);
}

// 2. Patch MainActivity.java or MainActivity.kt to prompt runtime CAMERA permission on app launch
const javaMain = path.join('android', 'app', 'src', 'main', 'java', 'com', 'scangudang', 'wms', 'MainActivity.java');
const ktMain = path.join('android', 'app', 'src', 'main', 'java', 'com', 'scangudang', 'wms', 'MainActivity.kt');

if (fs.existsSync(javaMain)) {
  const javaCode = [
    'package com.scangudang.wms;',
    '',
    'import android.Manifest;',
    'import android.content.pm.PackageManager;',
    'import android.graphics.Color;',
    'import android.os.Bundle;',
    'import android.view.Window;',
    'import androidx.core.app.ActivityCompat;',
    'import androidx.core.content.ContextCompat;',
    'import androidx.core.view.WindowCompat;',
    'import androidx.core.view.WindowInsetsControllerCompat;',
    'import com.getcapacitor.BridgeActivity;',
    '',
    'public class MainActivity extends BridgeActivity {',
    '  @Override',
    '  public void onCreate(Bundle savedInstanceState) {',
    '    super.onCreate(savedInstanceState);',
    '    try {',
    '      Window window = getWindow();',
    '      WindowCompat.setDecorFitsSystemWindows(window, true);',
    '      window.setStatusBarColor(Color.parseColor("#F4F4F5"));',
    '      window.setNavigationBarColor(Color.parseColor("#F4F4F5"));',
    '      WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());',
    '      if (controller != null) {',
    '        controller.setAppearanceLightStatusBars(true);',
    '        controller.setAppearanceLightNavigationBars(true);',
    '      }',
    '    } catch (Exception ignored) {}',
    '    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {',
    '      ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, 1001);',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(javaMain, javaCode, 'utf8');
  console.log('Patched MainActivity.java for runtime CAMERA permission prompt and seamless fullscreen bars.');
} else if (fs.existsSync(ktMain)) {
  const ktCode = [
    'package com.scangudang.wms',
    '',
    'import android.Manifest',
    'import android.content.pm.PackageManager',
    'import android.graphics.Color',
    'import android.os.Bundle',
    'import androidx.core.app.ActivityCompat',
    'import androidx.core.content.ContextCompat',
    'import androidx.core.view.WindowCompat',
    'import com.getcapacitor.BridgeActivity',
    '',
    'class MainActivity : BridgeActivity() {',
    '  override fun onCreate(savedInstanceState: Bundle?) {',
    '    super.onCreate(savedInstanceState)',
    '    try {',
    '      WindowCompat.setDecorFitsSystemWindows(window, true)',
    '      window.statusBarColor = Color.parseColor("#F4F4F5")',
    '      window.navigationBarColor = Color.parseColor("#F4F4F5")',
    '      WindowCompat.getInsetsController(window, window.decorView)?.apply {',
    '        isAppearanceLightStatusBars = true',
    '        isAppearanceLightNavigationBars = true',
    '      }',
    '    } catch (_: Exception) {}',
    '    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {',
    '      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1001)',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(ktMain, ktCode, 'utf8');
  console.log('Patched MainActivity.kt for runtime CAMERA permission prompt and seamless fullscreen bars.');
} else {
  console.warn('Warning: MainActivity not found in android/app/src/main/java/com/scangudang/wms/');
}

