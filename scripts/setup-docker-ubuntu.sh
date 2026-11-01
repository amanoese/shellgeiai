#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -eq 0 ]]; then
  echo "通常ユーザーで実行してください。必要な操作には sudo を使います。" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "OS を確認できません。Ubuntu で実行してください。" >&2
  exit 1
fi

source /etc/os-release
if [[ ${ID:-} != ubuntu ]]; then
  echo "このスクリプトは Ubuntu 専用です。" >&2
  exit 1
fi

docker_user=$(id -un)
ubuntu_codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
if [[ -z $ubuntu_codename ]]; then
  echo "Ubuntu のコードネームを確認できません。" >&2
  exit 1
fi

echo "Docker Engine をインストールします。sudo のパスワードを入力してください。"
sudo -v
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $ubuntu_codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$docker_user"

echo "ShellGeiAI の既定イメージを取得します。"
sudo docker pull theoldmoon0602/shellgeibot

echo
echo "Docker のインストールが完了しました。"
echo "docker グループを反映するため、ログアウトして再ログインしてください。"
echo "再ログイン後、プロジェクトで npm run test:docker を実行してください。"
echo "注意: docker グループには実質的に root 相当の権限があります。"
