; Instalador do Mamacos Voip — ajustes no padrão do electron-builder.
;
; ANTIVÍRUS: por padrão, o instalador do electron-builder verifica se o app
; está aberto rodando um PowerShell escondido (Get-CimInstance /
; Stop-Process) ou, sem PowerShell, um "cmd.exe /C tasklist | findstr" e
; "cmd.exe /C taskkill". Um instalador baixado da internet abrindo
; cmd/PowerShell oculto é exatamente o que as heurísticas de antivírus
; procuram — era isso que fazia o antivírus pegar a instalação.
;
; Aqui a mesma verificação é feita pelo plugin nsProcess, que já vem
; dentro do instalador e conversa direto com o Windows: nenhum cmd.exe
; nem powershell.exe é aberto.

!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      ; Atualização automática: o app já está fechando sozinho.
      Sleep 1500
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${endIf}

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      DetailPrint "$(appClosing)"
      ; Primeiro pede pra fechar (como clicar no X)...
      ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 2000
      ; ...e só força se ainda estiver aberto.
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1000
      ${endIf}
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDOK
        Quit
      ${endIf}
    ${endIf}
  ${endIf}
  ${nsProcess::Unload}
!macroend
