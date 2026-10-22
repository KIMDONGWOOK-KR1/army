# User-run only. Registers an immutable review copy in the designated dev project.
# Actual content files and secrets are never copied into the Vercel archive.
param([switch]$TributeWall, [switch]$Gps)

$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$devRef = 'vmadbgniurfzqygqidzw'
$arrivalMode = if ($Gps) { 'gps' } else { 'simulated' }
$coursePrefix = if ($Gps) { 'jnu-demo-dev-review-gps-' } else { 'jnu-demo-dev-review-' }
$courseId = $coursePrefix + (Get-Date -Format 'yyyyMMddHHmmss')
$contentFile = Join-Path $repoPath 'private\official-authoring\course.content.private.local.json'
$answersFile = Join-Path $repoPath 'private\official-authoring\course.answers.private.local.json'
$projectFile = 'C:\Users\kjy00\Desktop\Real\army\.vercel\project.json'
$originalLocation = Get-Location

foreach ($requiredFile in @($contentFile, $answersFile, $projectFile)) {
    if (!(Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "필수 로컬 파일 없음: $requiredFile" }
}
$vercelProject = Get-Content -Raw -LiteralPath $projectFile | ConvertFrom-Json
if ($vercelProject.projectName -ne 'hoguk-dev-web') { throw 'Vercel dev 프로젝트 연결을 확인하세요' }
$changes = @(git -C $repoPath status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw 'Git 상태 확인 실패' }
if ($changes.Count -ne 0) { throw '추적 파일의 미커밋 변경을 정리한 뒤 실행하세요. 배포에는 HEAD를 사용합니다.' }

try {
    Set-Location (Join-Path $repoPath 'web')
    $wallArgs = if ($TributeWall) { @('--wall-mode', 'tribute') } else { @() }
    Write-Host "등록할 검수 코스 ID: $courseId"
    $env:NEXT_PUBLIC_SUPABASE_URL = "https://$devRef.supabase.co"
    $serviceKeyInput = Read-Host 'dev service_role 키' -AsSecureString
    $saltInput = Read-Host '기존 Edge ANSWER_SALT와 같은 값' -AsSecureString
    try {
        $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $serviceKeyInput).Password
        $env:ANSWER_SALT = [System.Net.NetworkCredential]::new('', $saltInput).Password
        npm.cmd run seed:review -- --validate-only --dev-project-ref $devRef --course-id $courseId --arrival-mode $arrivalMode @wallArgs $contentFile $answersFile
        if ($LASTEXITCODE -ne 0) { throw '검수 코스 검증 실패: 등록 중지' }
        npm.cmd run seed:review -- --dev-project-ref $devRef --course-id $courseId --arrival-mode $arrivalMode @wallArgs $contentFile $answersFile
        if ($LASTEXITCODE -ne 0) { throw '검수 코스 등록 실패: 배포 중지' }
    } finally {
        Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:ANSWER_SALT -ErrorAction SilentlyContinue
        if ($null -ne $serviceKeyInput) { $serviceKeyInput.Dispose() }
        if ($null -ne $saltInput) { $saltInput.Dispose() }
    }

    npx.cmd supabase functions deploy game --project-ref $devRef
    if ($LASTEXITCODE -ne 0) { throw 'Edge 배포 실패: 웹 배포 중지' }

    $deployRoot = Join-Path (Split-Path $repoPath -Parent) ".deploy\review-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
    git -C $repoPath archive --format=zip --output "$deployRoot.zip" HEAD
    if ($LASTEXITCODE -ne 0) { throw '배포 파일 준비 실패' }
    Expand-Archive -LiteralPath "$deployRoot.zip" -DestinationPath $deployRoot
    New-Item -ItemType Directory -Path "$deployRoot\.vercel" -Force | Out-Null
    Copy-Item -LiteralPath $projectFile -Destination "$deployRoot\.vercel\project.json"
    Set-Location $deployRoot
    npx.cmd vercel --prod
    if ($LASTEXITCODE -ne 0) { throw '웹 배포 실패: 활성 코스 전환 중지. 권한 오류라면 vercel login 후 다시 실행하세요.' }

    Set-Location (Join-Path $repoPath 'web')
    npx.cmd supabase secrets set "ACTIVE_COURSE_ID=$courseId" 'DEV_ALLOW_SYNTHETIC_COURSE=true' --project-ref $devRef
    if ($LASTEXITCODE -ne 0) { throw '활성 코스 설정 실패' }
    npx.cmd supabase functions deploy game --project-ref $devRef
    if ($LASTEXITCODE -ne 0) { throw '최종 Edge 배포 실패: 재배포 후 새 방을 확인하세요' }
    Write-Host "완료: $courseId"
    if ($Gps) {
        Write-Host 'https://hoguk-dev-web.vercel.app/ 에서 새 방을 만들고 네 명 각각 GPS 도착 조건을 충족하세요.'
        Write-Host '추모의 벽 좌표가 미등록이면 해당 거점에서 진행 대기합니다. GPS 검수 코스는 모의 도착으로 우회할 수 없습니다.'
    } else {
        Write-Host 'https://hoguk-dev-web.vercel.app/ 에서 새 방을 만들고 네 명 각각 모의 도착하세요.'
    }
} finally {
    Set-Location $originalLocation
}
