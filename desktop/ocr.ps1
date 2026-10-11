# Texterkennung mit der in Windows eingebauten Erkennung (Windows.Media.Ocr).
# Läuft dauerhaft: liest pro Zeile einen Bildpfad (PNG), antwortet pro Zeile mit JSON {words:[{t,x,y,w,h}]}.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
  $engine = $null
  foreach ($tag in @('de-DE', 'de')) { if (-not $engine) { try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($tag)) } catch { } } }
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { [Console]::Out.WriteLine('{"error":"Windows hat keine Texterkennung für diese Sprache installiert"}'); exit 1 }
  $langs = ([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ','
  [Console]::Out.WriteLine((@{ ready = $true; lang = $engine.RecognizerLanguage.LanguageTag; langs = $langs; max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension } | ConvertTo-Json -Compress))
} catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)); exit 1 }
while ($true) {
  $p = [Console]::In.ReadLine()
  if ($p -eq $null -or $p -eq '') { break }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $words = New-Object System.Collections.ArrayList
    foreach ($l in $res.Lines) { foreach ($w in $l.Words) { $r = $w.BoundingRect; [void]$words.Add(@{ t = $w.Text; x = [math]::Round($r.X, 1); y = [math]::Round($r.Y, 1); w = [math]::Round($r.Width, 1); h = [math]::Round($r.Height, 1) }) } }
    $bmp.Dispose(); $stream.Dispose()
    [Console]::Out.WriteLine((@{ ok = $true; words = @($words); angle = $res.TextAngle } | ConvertTo-Json -Compress -Depth 4))
  } catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
}
