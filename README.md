# EX-schedule-autonomous（自律運用版・共有スケジュール）

サーバー管理・Firebase契約・コード編集を一切不要にした、全員共有のスケジュール・案件・希望休管理Webアプリです。

## 解決済みの仕組み（旧版 `schedule-share` の制約をすべて解消）

1. **共有データの保存先は1つに完全統一（自前サーバー・SQLite不要）**
   - 画面は **GitHub Pages**（`https://tahaga-64.github.io/EX-schedule-autonomous/`）から無料・無期限で配信されます。
   - データの保存先は、自前PCやSQLiteサーバーではなく **CryptPad の公開E2EE（エンドツーエンド暗号化）リレー上の単一チャンネル（`6bfb4e7051e0512db416ed77272a214f`）** に統一されています。
   - 誰がどのスマホ・PCから開いても、常に同じ1つの暗号化保存先を読み書きし、リアルタイムで全員の画面に同期されます。
   - 万一URL末尾の `#ch=...` が外れた状態で開いたり、ホーム画面アイコンから起動した場合でも、自動的にチームの共通保存先（`6bfb4e7051e0512db416ed77272a214f`）へ接続されます。

2. **スマホの「ホーム画面に追加（PWA）」に完全対応**
   - `manifest.webmanifest`・`apple-touch-icon.png`・各種PWAアイコン（192px / 512px / maskable）を内蔵しています。
   - iPhone（Safariの「共有」→「ホーム画面に追加」）および Android（Chromeの「ホーム画面に追加 / アプリをインストール」）から、ネイティブアプリのようにホーム画面へ追加してフル画面で利用できます。
   - ホーム画面から起動した際も、自動的にチームの共通保存先へ接続されます（`?readonly=1` で追加した場合は閲覧専用モードになります）。

3. **画面からのメンバー管理（追加・名前変更・担当者設定・並び替え・削除）**
   - ヘッダーの「メンバー管理」ボタンから、コードを触らずにいつでもメンバーの追加・改名・削除・順番変更が可能です。

## 共有URL

- **編集用URL（予定の編集・申請承認・メンバー管理が可能）**
  `https://tahaga-64.github.io/EX-schedule-autonomous/#ch=6bfb4e7051e0512db416ed77272a214f&k=H1v6HzcScIhTBLBG_5_KFxGdplm4JWZt3Nty2igD2yk&s=PtBhgQTxv1rxsN-7axzELS78bDtz79--kxnRH9POy-4`
- **閲覧専用URL（閲覧のみ・書き換え不可）**
  `https://tahaga-64.github.io/EX-schedule-autonomous/?readonly=1#ch=6bfb4e7051e0512db416ed77272a214f&k=H1v6HzcScIhTBLBG_5_KFxGdplm4JWZt3Nty2igD2yk&v=s9xob80sBjLmqVdWGDyV4uT-0itxIzOkZke9jr5lYpI`
