# deploy-to-aws.ps1 - Automated EC2 provisioning and code deployment script
$ErrorActionPreference = "Continue"


$AWS_CLI = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$REGION = "us-west-1"
$KEY_NAME = "apex-key"
$SG_NAME = "apex-sg"
$AMI_ID = "ami-083532ada23c5c24c" # Verified Ubuntu 22.04 LTS for us-west-1
$INSTANCE_TYPE = "t3.micro"
$WORKSPACE = "C:\Users\richi\Desktop\apex"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   Apex Classroom - AWS EC2 Provisioning     " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Ensure Key Pair exists
$PEM_PATH = Join-Path $WORKSPACE "apex-key.pem"
if (-not (Test-Path $PEM_PATH)) {
    Write-Host "[1/6] Creating AWS Key Pair '$KEY_NAME'..." -ForegroundColor Yellow
    
    # Check if key pair already exists on AWS, delete it to sync if file was lost
    $existingKeys = & $AWS_CLI ec2 describe-key-pairs --region $REGION --query "KeyPairs[?KeyName=='$KEY_NAME'].KeyName" --output text
    if ($existingKeys -eq $KEY_NAME) {
        Write-Host "Key pair exists on AWS but local file is missing. Deleting remote key pair to recreate..." -ForegroundColor Gray
        & $AWS_CLI ec2 delete-key-pair --region $REGION --key-name $KEY_NAME
    }
    
    $keyMaterial = & $AWS_CLI ec2 create-key-pair --region $REGION --key-name $KEY_NAME --query "KeyMaterial" --output text
    $keyMaterial | Out-File -FilePath $PEM_PATH -Encoding ascii
    Write-Host "Key pair saved to $PEM_PATH" -ForegroundColor Green
    
    # Restrict permissions on the private key file so ssh / scp doesn't complain about unprotected files
    Write-Host "Restricting private key file permissions (NTFS ACL)..." -ForegroundColor Gray
    & icacls.exe $PEM_PATH /reset
    & icacls.exe $PEM_PATH /grant:r "$($env:USERNAME):R"
    & icacls.exe $PEM_PATH /inheritance:r
} else {
    Write-Host "[1/6] Using existing Key Pair '$KEY_NAME'..." -ForegroundColor Green
}

# 2. Ensure Security Group exists
Write-Host "[2/6] Configuring Security Group '$SG_NAME'..." -ForegroundColor Yellow
$sgId = & $AWS_CLI ec2 describe-security-groups --region $REGION --filters "Name=group-name,Values=$SG_NAME" --query "SecurityGroups[0].GroupId" --output text

if ($sgId -eq "None" -or $sgId -eq $null -or $sgId -eq "") {
    Write-Host "Security Group '$SG_NAME' not found. Creating..." -ForegroundColor Gray
    $sgResponse = & $AWS_CLI ec2 create-security-group --region $REGION --group-name $SG_NAME --description "Security group for Apex Classroom" --output json | ConvertFrom-Json
    $sgId = $sgResponse.GroupId
    Write-Host "Security Group created with ID: $sgId" -ForegroundColor Green
} else {
    Write-Host "Using existing Security Group: $sgId" -ForegroundColor Green
}

# 3. Add Ports Inbound Ingress Rules (Ignored if already exists)
Write-Host "Setting Security Group firewall rules..." -ForegroundColor Gray
$ports = @(
    @{ Port = 22;   Protocol = "tcp"; Desc = "SSH Port" },
    @{ Port = 80;   Protocol = "tcp"; Desc = "HTTP Port" },
    @{ Port = 443;  Protocol = "tcp"; Desc = "HTTPS Port" },
    @{ Port = 3000; Protocol = "tcp"; Desc = "Node Web App Port" },
    @{ Port = 7880; Protocol = "tcp"; Desc = "LiveKit WS/API Port" },
    @{ Port = 7882; Protocol = "udp"; Desc = "LiveKit Media Port" }
)

foreach ($p in $ports) {
    try {
        & $AWS_CLI ec2 authorize-security-group-ingress --region $REGION --group-id $sgId --protocol $($p.Protocol) --port $($p.Port) --cidr 0.0.0.0/0
        Write-Host "  -> Opened Port $($p.Port) ($($p.Desc)) [$($p.Protocol)]" -ForegroundColor Green
    } catch {
        # Catch and ignore "InvalidPermission.Duplicate" error
        Write-Host "  -> Port $($p.Port) ($($p.Desc)) [$($p.Protocol)] is already configured." -ForegroundColor Gray
    }
}

# 4. Check if an instance already exists, otherwise provision and launch
Write-Host "[3/6] Checking for existing running EC2 instance named 'apex-server'..." -ForegroundColor Yellow
$existingInstances = & $AWS_CLI ec2 describe-instances --region $REGION --filters "Name=tag:Name,Values=apex-server" "Name=instance-state-name,Values=running" --query "Reservations[*].Instances[*].InstanceId" --output text
$instanceId = ""
if ($existingInstances -and $existingInstances -ne "None" -and $existingInstances -ne "") {
    # Get the first running instance ID
    $instanceId = $existingInstances.Split("`t")[0].Split("`n")[0].Split("`r")[0].Split(" ")[0].Trim()
    Write-Host "Found existing running EC2 instance with ID: $instanceId" -ForegroundColor Green
} else {
    Write-Host "No running instance found. Spawning new EC2 Instance ($INSTANCE_TYPE)..." -ForegroundColor Gray
    $runInstance = & $AWS_CLI ec2 run-instances --region $REGION --image-id $AMI_ID --count 1 --instance-type $INSTANCE_TYPE --key-name $KEY_NAME --security-group-ids $sgId --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=apex-server}]' --output json | ConvertFrom-Json
    $instanceId = $runInstance.Instances[0].InstanceId
    Write-Host "Instance requested successfully. ID: $instanceId" -ForegroundColor Green
    
    # 5. Wait for instance to boot and obtain Public IP
    Write-Host "[4/6] Waiting for instance to change state to RUNNING..." -ForegroundColor Yellow
    & $AWS_CLI ec2 wait instance-running --region $REGION --instance-ids $instanceId
}

$ip = & $AWS_CLI ec2 describe-instances --region $REGION --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text
Write-Host "Instance is running! Public IP: $ip" -ForegroundColor Green

# 6. Compress and Zip codebase
Write-Host "[5/6] Archiving local codebase into apex-deploy.zip..." -ForegroundColor Yellow
$zipPath = Join-Path $WORKSPACE "apex-deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Find all items except node_modules, git assets, pem keys, zip itself, and this PS script
$files = Get-ChildItem -Path $WORKSPACE -Exclude "node_modules", ".git", "apex.db", "apex.db-shm", "apex.db-wal", "apex-key.pem", "apex-deploy.zip", "deploy-to-aws.ps1"
Compress-Archive -Path $files.FullName -DestinationPath $zipPath -Force
Write-Host "Created deployment zip archive at: $zipPath" -ForegroundColor Green

# 7. Establish SSH connection and upload
Write-Host "[6/6] Establishing SSH link to Ubuntu server..." -ForegroundColor Yellow
$connected = $false
for ($i = 1; $i -le 20; $i++) {
    Write-Host "Connecting to SSH (Attempt $i/20)..." -ForegroundColor Gray
    # Perform a quick echo test
    & ssh.exe -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i $PEM_PATH "ubuntu@$ip" "echo SSH-ready" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $connected = $true
        break
    }
    Start-Sleep -Seconds 4
}

if (-not $connected) {
    Write-Error "Could not connect to the remote EC2 instance via SSH. Check your AWS Console state and try again."
    exit 1
}
Write-Host "SSH Connection established successfully!" -ForegroundColor Green

# Upload files via SCP
Write-Host "Uploading apex-deploy.zip and bootstrap setup.sh..." -ForegroundColor Gray
& scp.exe -o StrictHostKeyChecking=no -i $PEM_PATH $zipPath "ubuntu@${ip}:~/apex-deploy.zip"
& scp.exe -o StrictHostKeyChecking=no -i $PEM_PATH "$WORKSPACE\setup.sh" "ubuntu@${ip}:~/setup.sh"

# Run remote setup script (Split into separate commands to avoid && parser issues)
Write-Host "Executing remote bootstrap setup..." -ForegroundColor Yellow
& ssh.exe -o StrictHostKeyChecking=no -i $PEM_PATH "ubuntu@$ip" "chmod +x ~/setup.sh"

# Parse Google OAuth credentials from local .env
$googleClientId = ""
$googleClientSecret = ""
$envFile = Join-Path $WORKSPACE ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | Foreach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim()
                $val = $val -replace "^['`"]", "" -replace "['`"]$", ""
                if ($key -eq "GOOGLE_CLIENT_ID") { $googleClientId = $val }
                elseif ($key -eq "GOOGLE_CLIENT_SECRET") { $googleClientSecret = $val }
            }
        }
    }
}

& ssh.exe -o StrictHostKeyChecking=no -i $PEM_PATH "ubuntu@$ip" "bash ~/setup.sh $ip '$googleClientId' '$googleClientSecret'"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "   DEPLOYMENT SUCCESSFUL!                               " -ForegroundColor Green
Write-Host "   Your Apex Classroom is hosted at:                    " -ForegroundColor Green
Write-Host "   URL: http://$ip:3000                                 " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
