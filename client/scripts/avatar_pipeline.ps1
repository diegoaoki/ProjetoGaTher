# Pipeline: extrai idle+walk de cada peça do LimeZu Character Generator
# para o formato do jogo (384x32). Gera tb _thumbs.png + manifest.json
# por slot (UI usa 1 sheet de thumbs, NÃO carrega 850 texturas).
Add-Type -AssemblyName System.Drawing

$GEN = 'C:\Users\DiegoAoki\Downloads\Assets Pagos\moderninteriors-win\2_Characters\Character_Generator'
$OUT = 'C:\_Gather\ProjetoGaTher\client\public\assets\characters\parts'

# slot -> @(pasta de origem, regex p/ extrair key do nome do arquivo, prefixo)
$slots = @(
  @{ name='body';   src="$GEN\Bodies\16x16";       prefix='body' },
  @{ name='hair';   src="$GEN\Hairstyles\16x16";   prefix='hair' },
  @{ name='outfit'; src="$GEN\Outfits\16x16";      prefix='outfit' },
  @{ name='hat';    src="$GEN\Accessories\16x16";  prefix='hat' }
)

function Save-Sheet($bmp, $path) {
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
}

foreach ($s in $slots) {
  $dir = Join-Path $OUT $s.name
  New-Item -ItemType Directory -Force $dir | Out-Null
  $imgs = Get-ChildItem $s.src -Filter *.png | Sort-Object Name
  $manifest = @()
  $thumbs = New-Object System.Collections.ArrayList
  foreach ($img in $imgs) {
    $raw = [IO.Path]::GetFileNameWithoutExtension($img.Name)
    # normaliza: minusculo, troca tudo que nao for alfanum por _ , tira prefixo do tipo
    $key = $raw.ToLower()
    $key = $key -replace '^(body|hairstyle|outfit|accessory)_?',''
    $key = $key -replace '[^a-z0-9]+','_'
    $key = $key.Trim('_')
    $key = "$($s.prefix)_$key"

    $b = [System.Drawing.Bitmap]::FromFile($img.FullName)
    # WALK = row1 (y32), x0..383 -> 384x32 direto
    $run = New-Object Drawing.Bitmap 384,32
    $g = [Drawing.Graphics]::FromImage($run)
    $g.DrawImage($b,(New-Object Drawing.Rectangle 0,0,384,32),(New-Object Drawing.Rectangle 0,32,384,32),'Pixel')
    $g.Dispose()
    Save-Sheet $run (Join-Path $dir "$key`_run.png")

    # IDLE = row0 (y0), 1 frame/dir (col0=R,1=U,2=L,3=D) replicado x6 -> 384x32
    $idle = New-Object Drawing.Bitmap 384,32
    $g2 = [Drawing.Graphics]::FromImage($idle)
    for ($d=0; $d -lt 4; $d++) {
      for ($k=0; $k -lt 6; $k++) {
        $dx = ($d*6+$k)*16
        $g2.DrawImage($b,(New-Object Drawing.Rectangle $dx,0,16,32),(New-Object Drawing.Rectangle ($d*16),0,16,32),'Pixel')
      }
    }
    $g2.Dispose()
    Save-Sheet $idle (Join-Path $dir "$key`_idle.png")

    # thumb = idle frente (dir D = col3 da row0), 16x32
    $th = New-Object Drawing.Bitmap 16,32
    $gt = [Drawing.Graphics]::FromImage($th)
    $gt.DrawImage($b,(New-Object Drawing.Rectangle 0,0,16,32),(New-Object Drawing.Rectangle 48,0,16,32),'Pixel')
    $gt.Dispose()
    [void]$thumbs.Add(@{ key=$key; bmp=$th })

    $manifest += $key
    $b.Dispose(); $run.Dispose(); $idle.Dispose()
  }
  # contact sheet de thumbs: grade de 16x32, 16 colunas
  $cols = 16
  $rows = [Math]::Ceiling($thumbs.Count / $cols)
  $sheet = New-Object Drawing.Bitmap ($cols*16), ($rows*32)
  $gs = [Drawing.Graphics]::FromImage($sheet)
  for ($i=0; $i -lt $thumbs.Count; $i++) {
    $cx = ($i % $cols) * 16
    $cy = [Math]::Floor($i / $cols) * 32
    $gs.DrawImage($thumbs[$i].bmp, $cx, $cy)
    $thumbs[$i].bmp.Dispose()
  }
  $gs.Dispose()
  Save-Sheet $sheet (Join-Path $dir "_thumbs.png")
  $sheet.Dispose()
  ($manifest | ConvertTo-Json -Compress) | Set-Content -Encoding utf8 (Join-Path $dir "manifest.json")
  Write-Output ("{0}: {1} pecas -> {2} sheets + _thumbs ({3}x{4}) + manifest" -f $s.name,$manifest.Count,($manifest.Count*2),$cols,$rows)
}
Write-Output 'PIPELINE OK'
