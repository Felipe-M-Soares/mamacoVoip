package com.mamacosvoip.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Atualização do app Android sem Play Store: baixa o APK novo do GitHub
// (só de github.com — ver isAllowedUrl) pra pasta de cache do app e abre
// o instalador do Android. O próprio Android só aceita instalar por cima
// se o APK novo tiver a MESMA assinatura do instalado, então um arquivo
// trocado/falso nunca substitui o app.
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

  private static boolean isAllowedUrl(String url) {
    try {
      URL u = new URL(url);
      return "https".equals(u.getProtocol()) && "github.com".equals(u.getHost());
    } catch (Exception e) {
      return false;
    }
  }

  @PluginMethod
  public void download(final PluginCall call) {
    final String url = call.getString("url");
    if (url == null || !isAllowedUrl(url)) {
      call.reject("Endereço de atualização inválido");
      return;
    }
    new Thread(() -> {
      HttpURLConnection conn = null;
      try {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Sem espaço para a atualização");
        File out = new File(dir, "MamacosVoip.apk");
        File tmp = new File(dir, "MamacosVoip.apk.part");

        // Segue os redirecionamentos do GitHub (github.com → servidor de
        // arquivos deles), sempre em https.
        URL current = new URL(url);
        for (int i = 0; i < 6; i++) {
          conn = (HttpURLConnection) current.openConnection();
          conn.setInstanceFollowRedirects(false);
          conn.setConnectTimeout(15000);
          conn.setReadTimeout(30000);
          int code = conn.getResponseCode();
          if (code >= 300 && code < 400) {
            String loc = conn.getHeaderField("Location");
            conn.disconnect();
            conn = null;
            if (loc == null) throw new Exception("Redirecionamento sem destino");
            current = new URL(current, loc);
            if (!"https".equals(current.getProtocol())) throw new Exception("Redirecionamento inseguro");
            continue;
          }
          if (code != 200) throw new Exception("Falha ao baixar (" + code + ")");
          break;
        }
        if (conn == null) throw new Exception("Redirecionamentos demais");

        long total = conn.getContentLengthLong();
        long done = 0;
        int lastPercent = -1;
        try (InputStream in = conn.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
          byte[] buf = new byte[64 * 1024];
          int n;
          while ((n = in.read(buf)) != -1) {
            os.write(buf, 0, n);
            done += n;
            if (total > 0) {
              int percent = (int) (done * 100 / total);
              if (percent != lastPercent) {
                lastPercent = percent;
                JSObject p = new JSObject();
                p.put("percent", percent);
                notifyListeners("progress", p);
              }
            }
          }
        }
        if (total > 0 && done != total) throw new Exception("Download incompleto");
        if (out.exists() && !out.delete()) throw new Exception("Não foi possível substituir o arquivo");
        if (!tmp.renameTo(out)) throw new Exception("Não foi possível salvar a atualização");

        JSObject ret = new JSObject();
        ret.put("path", out.getAbsolutePath());
        call.resolve(ret);
      } catch (Exception e) {
        call.reject(e.getMessage() != null ? e.getMessage() : "Falha ao baixar a atualização");
      } finally {
        if (conn != null) conn.disconnect();
      }
    }).start();
  }

  @PluginMethod
  public void install(PluginCall call) {
    try {
      // Android 8+: precisa da permissão "instalar apps desconhecidos"
      // pra ESTE app. Sem ela, abre a tela de ajuste pra pessoa liberar.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          && !getContext().getPackageManager().canRequestPackageInstalls()) {
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settings);
        JSObject ret = new JSObject();
        ret.put("needsPermission", true);
        call.resolve(ret);
        return;
      }
      File apk = new File(new File(getContext().getCacheDir(), "updates"), "MamacosVoip.apk");
      if (!apk.exists()) {
        call.reject("Atualização não encontrada");
        return;
      }
      Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      JSObject ret = new JSObject();
      ret.put("needsPermission", false);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "Falha ao abrir o instalador");
    }
  }
}
