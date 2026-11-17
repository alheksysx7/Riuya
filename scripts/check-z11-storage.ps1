[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$JournalPath,
    [Parameter(Mandatory = $true)][string]$AnchorPath,
    [Parameter(Mandatory = $true)][string]$CheckpointPath
)

$ErrorActionPreference = 'Stop'

function Get-StorageLocation {
    param([string]$Label, [string]$Path)
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "La ruta de $Label debe ser absoluta."
    }
    $item = Get-Item -LiteralPath $Path -Force
    $current = $item
    while ($null -ne $current) {
        if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "La ruta de $Label contiene un enlace o punto de montaje; requiere revisión manual."
        }
        $parent = [System.IO.Path]::GetDirectoryName($current.FullName)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current.FullName) { break }
        $current = Get-Item -LiteralPath $parent -Force
    }
    $volume = Get-Volume -FilePath $item.FullName
    $partitions = @(Get-Partition -Volume $volume)
    if ($partitions.Count -ne 1) {
        throw "No se pudo identificar una única partición para $Label."
    }
    $disk = Get-Disk -Number $partitions[0].DiskNumber
    [PSCustomObject]@{
        Elemento = $Label
        Disco = [int]$disk.Number
        Particion = [int]$partitions[0].PartitionNumber
        Tipo = [string]$disk.BusType
    }
}

try {
    $journal = Get-StorageLocation 'Registro' $JournalPath
    $anchor = Get-StorageLocation 'Sello' $AnchorPath
    $checkpoint = Get-StorageLocation 'Punto de control' $CheckpointPath
    @($journal, $anchor, $checkpoint) | Format-Table -AutoSize
    if ($journal.Disco -eq $checkpoint.Disco) {
        Write-Output 'RESULTADO: el registro y el punto de control están en el mismo disco; no hay separación física.'
        exit 2
    }
    Write-Output 'RESULTADO: Windows informa discos distintos para registro y punto de control.'
    Write-Output 'Verificar manualmente que sean dispositivos físicos independientes y que las copias no se restauren juntas.'
    exit 0
} catch {
    Write-Error ("Diagnóstico no concluyente: " + $_.Exception.Message) -ErrorAction Continue
    exit 1
}
