Add-Type -AssemblyName System.Drawing

function New-Preview {
  param(
    [string]$OutPath,
    [System.Drawing.Color]$Bg,
    [System.Drawing.Color]$Chip,
    [System.Drawing.Color]$Text,
    [System.Drawing.Color]$Text2,
    [System.Drawing.Color]$Text3,
    [System.Drawing.Color]$Border,
    [System.Drawing.Color]$BtnBg,
    [System.Drawing.Color]$Ok,
    [System.Drawing.Color]$DotFert,
    [System.Drawing.Color]$DotWater
  )

  $w = 400; $h = 320
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear($Bg)

  $bigFont   = New-Object System.Drawing.Font 'Segoe UI', 11, ([System.Drawing.FontStyle]::Bold)
  $smallFont = New-Object System.Drawing.Font 'Segoe UI', 7.5
  $tinyFont  = New-Object System.Drawing.Font 'Segoe UI', 7
  $cardTitleFont = New-Object System.Drawing.Font 'Segoe UI', 8.5, ([System.Drawing.FontStyle]::Bold)
  $btnFont   = New-Object System.Drawing.Font 'Segoe UI', 7.5, ([System.Drawing.FontStyle]::Bold)

  $brText  = New-Object System.Drawing.SolidBrush $Text
  $brText2 = New-Object System.Drawing.SolidBrush $Text2
  $brText3 = New-Object System.Drawing.SolidBrush $Text3
  $brChip  = New-Object System.Drawing.SolidBrush $Chip
  $brBtnBg = New-Object System.Drawing.SolidBrush $BtnBg
  $brOk    = New-Object System.Drawing.SolidBrush $Ok
  $brFert  = New-Object System.Drawing.SolidBrush $DotFert
  $brWater = New-Object System.Drawing.SolidBrush $DotWater
  $brWhite = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $penBorder = New-Object System.Drawing.Pen $Border, 1

  # Header
  $g.DrawString('Lawn Manual Entry', $bigFont, $brText, 12, 10)
  $g.DrawString('My Lawn', $tinyFont, $brText3, 320, 16)

  # ── Helper: rounded rect ──
  function DrawRoundedRect($graphics, $brush, $pen, $x, $y, $width, $height, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $width - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $width - $d, $y + $height - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $height - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    if ($brush) { $graphics.FillPath($brush, $path) }
    if ($pen)   { $graphics.DrawPath($pen, $path) }
    $path.Dispose()
  }

  # ── Card 1: Fertiliser ──
  $cy = 36; $ch = 86
  DrawRoundedRect $g $brChip $penBorder 12 $cy 376 $ch 8
  $g.FillEllipse($brFert, 22, $cy + 12, 8, 8)
  $g.DrawString('Fertiliser', $cardTitleFont, $brText, 34, ($cy + 8))
  $g.DrawString('in 6 d', $tinyFont, $brText3, 336, ($cy + 10))

  $g.DrawString('Last: 2026-05-11  |  Next: 2026-06-22', $smallFont, $brText2, 22, ($cy + 28))

  # Buttons row
  $by = $cy + 50
  DrawRoundedRect $g $brOk $null 22 $by 170 26 6
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $btnTextRect1 = New-Object System.Drawing.RectangleF 22, $by, 170, 26
  $g.DrawString('Mark fertilised today', $btnFont, $brWhite, $btnTextRect1, $sf)

  DrawRoundedRect $g $brBtnBg $penBorder 198 $by 130 26 6
  $btnTextRect2 = New-Object System.Drawing.RectangleF 198, $by, 130, 26
  $g.DrawString('2026-06-14', $btnFont, $brText, $btnTextRect2, $sf)

  DrawRoundedRect $g $brBtnBg $penBorder 334 $by 54 26 6
  $btnTextRect3 = New-Object System.Drawing.RectangleF 334, $by, 54, 26
  $g.DrawString('Set', $btnFont, $brText, $btnTextRect3, $sf)

  # ── Card 2: Rain ──
  $cy = 130; $ch = 68
  DrawRoundedRect $g $brChip $penBorder 12 $cy 376 $ch 8
  $g.FillEllipse($brWater, 22, $cy + 12, 8, 8)
  $g.DrawString('Rain this week', $cardTitleFont, $brText, 34, ($cy + 8))
  $g.DrawString('12 mm', $tinyFont, $brText3, 348, ($cy + 10))

  $by = $cy + 32
  $btns = @(
    @{ x = 22;  w = 56;  t = '+2 mm' },
    @{ x = 84;  w = 56;  t = '+5 mm' },
    @{ x = 146; w = 60;  t = '+10 mm' },
    @{ x = 212; w = 110; t = 'mm' },
    @{ x = 328; w = 60;  t = 'Set' }
  )
  foreach ($b in $btns) {
    DrawRoundedRect $g $brBtnBg $penBorder $b.x $by $b.w 26 6
    $r = New-Object System.Drawing.RectangleF $b.x, $by, $b.w, 26
    $g.DrawString($b.t, $btnFont, $brText, $r, $sf)
  }

  # ── Card 3: Irrigation ──
  $cy = 206; $ch = 68
  DrawRoundedRect $g $brChip $penBorder 12 $cy 376 $ch 8
  $g.FillEllipse($brWater, 22, $cy + 12, 8, 8)
  $g.DrawString('Irrigation this week', $cardTitleFont, $brText, 34, ($cy + 8))
  $g.DrawString('8 mm', $tinyFont, $brText3, 352, ($cy + 10))

  $by = $cy + 32
  $btns2 = @(
    @{ x = 22;  w = 56;  t = '+5 mm' },
    @{ x = 84;  w = 60;  t = '+10 mm' },
    @{ x = 150; w = 60;  t = '+20 mm' },
    @{ x = 216; w = 106; t = 'mm' },
    @{ x = 328; w = 60;  t = 'Set' }
  )
  foreach ($b in $btns2) {
    DrawRoundedRect $g $brBtnBg $penBorder $b.x $by $b.w 26 6
    $r = New-Object System.Drawing.RectangleF $b.x, $by, $b.w, 26
    $g.DrawString($b.t, $btnFont, $brText, $r, $sf)
  }

  # Footer
  $g.DrawString('Updated: 2026-06-14 12:15:00', $tinyFont, $brText3, 12, 296)

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "Wrote $OutPath"
}

# Light theme
New-Preview `
  -OutPath 'widgets/lawn-manual-entry/preview-light.png' `
  -Bg      ([System.Drawing.Color]::FromArgb(245,245,243)) `
  -Chip    ([System.Drawing.Color]::FromArgb(234,234,232)) `
  -Text    ([System.Drawing.Color]::FromArgb(26,26,26)) `
  -Text2   ([System.Drawing.Color]::FromArgb(107,114,128)) `
  -Text3   ([System.Drawing.Color]::FromArgb(156,163,175)) `
  -Border  ([System.Drawing.Color]::FromArgb(23,0,0,0)) `
  -BtnBg   ([System.Drawing.Color]::FromArgb(10,0,0,0)) `
  -Ok      ([System.Drawing.Color]::FromArgb(76,175,80)) `
  -DotFert ([System.Drawing.Color]::FromArgb(255,152,0)) `
  -DotWater([System.Drawing.Color]::FromArgb(30,136,229))

# Dark theme
New-Preview `
  -OutPath 'widgets/lawn-manual-entry/preview-dark.png' `
  -Bg      ([System.Drawing.Color]::FromArgb(24,24,27)) `
  -Chip    ([System.Drawing.Color]::FromArgb(46,46,51)) `
  -Text    ([System.Drawing.Color]::FromArgb(244,244,245)) `
  -Text2   ([System.Drawing.Color]::FromArgb(161,161,170)) `
  -Text3   ([System.Drawing.Color]::FromArgb(113,113,122)) `
  -Border  ([System.Drawing.Color]::FromArgb(23,255,255,255)) `
  -BtnBg   ([System.Drawing.Color]::FromArgb(15,255,255,255)) `
  -Ok      ([System.Drawing.Color]::FromArgb(76,175,80)) `
  -DotFert ([System.Drawing.Color]::FromArgb(255,152,0)) `
  -DotWater([System.Drawing.Color]::FromArgb(30,136,229))
