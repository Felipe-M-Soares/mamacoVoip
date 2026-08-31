package com.mamacosvoip.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

// VIGÉSIMA SEXTA RODADA — sem isto, getUserMedia (câmera/microfone,
// chamado pelo mesmo código React de sempre, sem mudança nenhuma nele)
// simplesmente nunca funcionaria dentro do app Android: o Capacitor JÁ
// atende automaticamente o pedido de permissão da própria WebView (a
// caixinha "esse site quer usar seu microfone") DESDE QUE a permissão
// do Android em si (RECORD_AUDIO/CAMERA — as de "sistema operacional",
// diferentes da permissão do navegador) já tenha sido concedida antes.
// Sem pedir isso pelo menos uma vez em algum lugar, ela nunca aparece
// pra pessoa conceder, e a WebView acaba negando o pedido sozinha, sem
// erro nenhum visível — só o microfone/câmera simplesmente não
// funcionam. Pedir aqui, assim que o app abre, resolve isso da forma
// mais simples (um único diálogo do Android na primeira abertura, do
// jeito que qualquer app pede essas permissões).
//
// Não tenho como testar isto de verdade sem um dispositivo/emulador
// Android real (não existe isso neste ambiente) — é código Android
// padrão e bem documentado (o mesmíssimo usado por praticamente
// qualquer app que precise de câmera/microfone), mas o primeiro teste
// de verdade só acontece rodando isso no Android Studio.
public class MainActivity extends BridgeActivity {
  private static final int PERMISSION_REQUEST_CODE = 1001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    String[] needed = {Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA};
    java.util.List<String> missing = new java.util.ArrayList<>();
    for (String permission : needed) {
      if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
        missing.add(permission);
      }
    }
    if (!missing.isEmpty()) {
      ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), PERMISSION_REQUEST_CODE);
    }
  }
}
