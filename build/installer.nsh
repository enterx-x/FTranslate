!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var PlotRuntimeDialog
Var PlotRuntimePythonCheckbox
Var PlotRuntimeRCheckbox
Var PlotRuntimeMatlabCheckbox
Var PlotRuntimePython
Var PlotRuntimeR
Var PlotRuntimeMatlab

!macro customInit
  StrCpy $PlotRuntimePython "0"
  StrCpy $PlotRuntimeR "0"
  StrCpy $PlotRuntimeMatlab "0"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  Page custom PlotRuntimePageCreate PlotRuntimePageLeave
!macroend

Function PlotRuntimePageCreate
  nsDialogs::Create 1018
  Pop $PlotRuntimeDialog
  ${If} $PlotRuntimeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "可选绘图环境"
  Pop $0
  CreateFont $1 "$(^Font)" "12" "700"
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 29u 100% 30u "这里只记录首次启动后的配置意图。Python 和 R 将由应用内环境管理器从官方源下载并校验；MATLAB 仅检测已有安装。"
  Pop $0

  ${NSD_CreateCheckbox} 0 72u 100% 14u "准备 Python 科研绘图环境（Matplotlib / Seaborn / Plotly）"
  Pop $PlotRuntimePythonCheckbox
  ${NSD_SetState} $PlotRuntimePythonCheckbox ${BST_UNCHECKED}

  ${NSD_CreateCheckbox} 0 96u 100% 14u "准备 R 科研绘图环境（ggplot2 / patchwork / ComplexHeatmap）"
  Pop $PlotRuntimeRCheckbox
  ${NSD_SetState} $PlotRuntimeRCheckbox ${BST_UNCHECKED}

  ${NSD_CreateCheckbox} 0 120u 100% 14u "首次启动时检测本机 MATLAB（不下载、不安装）"
  Pop $PlotRuntimeMatlabCheckbox
  ${NSD_SetState} $PlotRuntimeMatlabCheckbox ${BST_UNCHECKED}

  ${NSD_CreateLabel} 0 153u 100% 32u "这些选项不会增大主安装包，也不会静默修改系统 PATH。稍后可在“科研绘图 → 管理环境”中更改安装目录或取消任务。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function PlotRuntimePageLeave
  ${NSD_GetState} $PlotRuntimePythonCheckbox $PlotRuntimePython
  ${NSD_GetState} $PlotRuntimeRCheckbox $PlotRuntimeR
  ${NSD_GetState} $PlotRuntimeMatlabCheckbox $PlotRuntimeMatlab
FunctionEnd

!macro customInstall
  CreateDirectory "$APPDATA\FTranslate"
  WriteINIStr "$APPDATA\FTranslate\plot-runtime-intent.ini" "PlotRuntimes" "Python" "$PlotRuntimePython"
  WriteINIStr "$APPDATA\FTranslate\plot-runtime-intent.ini" "PlotRuntimes" "R" "$PlotRuntimeR"
  WriteINIStr "$APPDATA\FTranslate\plot-runtime-intent.ini" "PlotRuntimes" "MatlabDetect" "$PlotRuntimeMatlab"
!macroend

!endif
