$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskIconPath = Join-Path $PSScriptRoot '../app/icon.ico'
$taskBitmap = [System.Drawing.Bitmap]::new(256, 256)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.Color]::FromArgb(36, 93, 70))
$taskTile = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(249, 252, 246))
$taskGreen = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(36, 93, 70))
$taskGraphics.FillRectangle($taskTile, 48, 27, 160, 193)
$taskFont = [System.Drawing.Font]::new('Microsoft YaHei', 82, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$taskFormat = [System.Drawing.StringFormat]::new()
$taskFormat.Alignment = [System.Drawing.StringAlignment]::Center
$taskGraphics.DrawString('中', $taskFont, $taskGreen, [System.Drawing.RectangleF]::new(48, 38, 160, 111), $taskFormat)
$taskGraphics.FillRectangle($taskGreen, 78, 175, 23, 22)
$taskGraphics.FillRectangle($taskGreen, 116, 157, 23, 40)
$taskGraphics.FillRectangle($taskGreen, 154, 139, 23, 58)
$taskPng = [System.IO.MemoryStream]::new()
$taskBitmap.Save($taskPng, [System.Drawing.Imaging.ImageFormat]::Png)
$taskBytes = $taskPng.ToArray()
$taskOutput = [System.IO.File]::Create($taskIconPath)
$taskWriter = [System.IO.BinaryWriter]::new($taskOutput)
try {
  $taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]1)
  $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
  $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32)
  $taskWriter.Write([uint32]$taskBytes.Length); $taskWriter.Write([uint32]22)
  $taskWriter.Write($taskBytes)
} finally {
  $taskWriter.Dispose(); $taskOutput.Dispose(); $taskPng.Dispose(); $taskFormat.Dispose()
  $taskFont.Dispose(); $taskGreen.Dispose(); $taskTile.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
