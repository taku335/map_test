# 金山駅周辺バス時刻表マップ

GTFS静的データを利用して、名古屋市・金山駅周辺のバス停と路線を地図上に表示するWebアプリです。  
停留所を選択すると、右サイドパネルで時刻表を確認できます。

## 公開URL

- [https://taku335.github.io/map_test/](https://taku335.github.io/map_test/)

## 主な機能

1. 金山駅を中心とした地図表示（半径5km）
2. バス停マーカー表示
3. バス路線ポリライン表示
4. 停留所クリック時の時刻表表示
5. 日付変更による時刻表参照
6. 停留所名/停留所ID検索

## 使い方

1. ブラウザで `index.html` を開きます。
2. 地図上の停留所をクリックすると、右側に時刻表が表示されます。
3. 必要に応じて日付を変更し、「次の10件」「その日の全便」を切り替えて確認します。

## Dockerで起動

1. イメージをビルドして起動します。
```bash
docker compose up --build
```
2. ブラウザで `http://localhost:8080` を開きます。

停止:
```bash
docker compose down
```

## GitHub Actionsデプロイ

このリポジトリには以下のWorkflowを追加済みです。

1. `Deploy to GitHub Pages`  
`main` へのpushでGitHub Pagesへ自動デプロイします。
2. `Publish Docker Image`  
`main` へのpushで `ghcr.io/<owner>/<repo>:latest` にDockerイメージを自動公開します。

### 初回設定

1. GitHubリポジトリの `Settings > Pages > Build and deployment` で `Source` を `GitHub Actions` に設定してください。
