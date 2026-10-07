[CmdletBinding()]
param(
    [string]$Message,
    [switch]$Preview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-ProjectGit {
    param([Parameter(Mandatory = $true, Position = 0)][string[]]$GitArguments)

    $result = @(& $script:GitExecutable -c "safe.directory=$script:RepositoryRoot" -C $script:RepositoryRoot @GitArguments)
    if ($LASTEXITCODE -ne 0) {
        throw "Git a échoué : $($GitArguments -join ' ') (code $LASTEXITCODE)."
    }
    return $result
}

try {
    $script:GitExecutable = (Get-Command git.exe -ErrorAction Stop).Source
    $script:RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    $gitRoot = [IO.Path]::GetFullPath((Invoke-ProjectGit @('rev-parse', '--show-toplevel')) -join '')
    if (-not [string]::Equals($gitRoot.TrimEnd([char[]]'\/'), $script:RepositoryRoot.TrimEnd([char[]]'\/'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Le script doit être installé dans le dossier scripts du dépôt à publier.'
    }

    $branch = (Invoke-ProjectGit @('symbolic-ref', '--quiet', '--short', 'HEAD')) -join ''
    if ($branch -ne 'main') {
        throw "Ce script publie la branche main. Branche actuelle : $branch."
    }
    $remote = (Invoke-ProjectGit @('remote', 'get-url', '--push', 'origin')) -join ''

    foreach ($operation in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $operationPath = (Invoke-ProjectGit @('rev-parse', '--git-path', $operation)) -join ''
        if (-not [IO.Path]::IsPathRooted($operationPath)) {
            $operationPath = Join-Path $script:RepositoryRoot $operationPath
        }
        if (Test-Path -LiteralPath $operationPath) {
            throw 'Une opération Git est en cours. Terminez-la avant de publier.'
        }
    }
    if (@(Invoke-ProjectGit @('diff', '--name-only', '--diff-filter=U')).Count -gt 0) {
        throw 'Des conflits Git doivent être résolus avant de publier.'
    }

    Write-Host ''
    Write-Host 'Compendium Memoriae — publication manuelle' -ForegroundColor Cyan
    Write-Host "Dossier : $script:RepositoryRoot"
    Write-Host "Destination : $remote (main)"
    Write-Host ''
    $changes = @(Invoke-ProjectGit @('status', '--short'))
    if ($changes.Count -gt 0) {
        Write-Host 'Fichiers à inclure dans le commit :'
        $changes | ForEach-Object { Write-Host $_ }
        Invoke-ProjectGit @('diff', '--stat', 'HEAD') | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host 'Aucun fichier modifié.'
    }
    Write-Host 'Les fichiers non suivis ignorés par .gitignore sont exclus.'

    if ($Preview) {
        Write-Host 'Aperçu terminé. Aucun commit, push ou accès réseau effectué.' -ForegroundColor Cyan
        exit 0
    }

    Write-Host ''
    Write-Host 'Vérification de la branche distante…'
    Invoke-ProjectGit @('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main') | ForEach-Object { Write-Host $_ }
    $comparison = (((Invoke-ProjectGit @('rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/main')) -join '').Trim()) -split '\s+'
    $ahead = [int]$comparison[0]
    $behind = [int]$comparison[1]
    if ($behind -gt 0) {
        throw "GitHub contient $behind commit(s) absent(s) en local. Récupérez ces changements et résolvez les éventuels conflits avant de relancer."
    }
    if ($changes.Count -eq 0 -and $ahead -eq 0) {
        Write-Host 'Tout est déjà à jour sur GitHub.' -ForegroundColor Green
        exit 0
    }
    if ($ahead -gt 0) {
        Write-Host "Commits locaux à envoyer : $ahead"
        Invoke-ProjectGit @('log', '--oneline', '--max-count=10', 'refs/remotes/origin/main..HEAD') | ForEach-Object { Write-Host $_ }
    }

    if ($changes.Count -gt 0) {
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $Message = Read-Host 'Message du commit (Entrée pour annuler)'
        }
        if ([string]::IsNullOrWhiteSpace($Message)) {
            Write-Host 'Publication annulée.'
            exit 0
        }
        $Message = $Message.Trim()
        Write-Host "Message : $Message"
    }
    $answer = Read-Host 'Envoyer ces changements vers GitHub ? [o/N]'
    if ($answer.Trim() -notmatch '^(o|oui)$') {
        Write-Host 'Publication annulée. Aucun commit ni push effectué.'
        exit 0
    }

    if (((Invoke-ProjectGit @('symbolic-ref', '--quiet', '--short', 'HEAD')) -join '') -ne 'main') {
        throw 'La branche a changé pendant la confirmation. Relancez le script.'
    }
    if ($changes.Count -gt 0) {
        Invoke-ProjectGit @('add', '--all', '--', '.') | ForEach-Object { Write-Host $_ }
        if (@(Invoke-ProjectGit @('diff', '--cached', '--name-only')).Count -gt 0) {
            Invoke-ProjectGit @('commit', '-m', $Message) | ForEach-Object { Write-Host $_ }
        }
    }
    Invoke-ProjectGit @('push', 'origin', 'main:refs/heads/main') | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host 'Publication envoyée à GitHub. GitHub Pages lance les tests et le déploiement.' -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Host "Publication arrêtée : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Vos fichiers et commits locaux sont conservés. Corrigez le problème, puis relancez le script.'
    exit 1
}
