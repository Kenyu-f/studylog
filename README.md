# Studylog

A simple, self-hosted study logging application for recording goals, study sessions, and progress.

Studylog is designed to make it easy to keep a persistent record of what you are studying and what you have accomplished.

[English](#english) · [日本語](#日本語) · [中文](#中文)

---

## English

### Overview

Studylog is a web application for keeping track of your study activities.

It allows users to record their study progress, manage goals, and keep their learning history in a PostgreSQL database.

The project is intentionally built with a relatively small and understandable architecture, making it suitable for personal use, experimentation, and further development.

### Features

* User authentication
* Persistent study data
* Study goal management
* Study session logging
* PostgreSQL database
* Server-side rendering with EJS
* TypeScript-based backend
* Express-based web server
* Local development support
* Deployment on Vercel
* Neon PostgreSQL support

### Technology

* TypeScript
* Node.js
* Express
* EJS
* PostgreSQL
* Neon
* Vercel

### Project Structure

```text
studylog/
├── api/
│   └── index.ts
├── public/
│   └── ...
├── src/
│   ├── db.ts
│   ├── auth.ts
│   ├── goals.ts
│   ├── studylog-app.ts
│   └── local-server.ts
├── test/
│   └── ...
├── views/
│   └── ...
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

### Requirements

* Node.js 20 or later
* npm
* PostgreSQL database

A Neon PostgreSQL database can be used for both development and production.

### Installation

Clone the repository:

```bash
git clone https://github.com/Kenyu-f/studylog.git
cd studylog
```

Install dependencies:

```bash
npm install
```

Set the database connection string:

```bash
export DATABASE_URL="postgresql://..."
```

Then start the development server:

```bash
npm run dev
```

The application will start locally.

### Environment Variables

Studylog currently requires:

```text
DATABASE_URL
```

`DATABASE_URL` must contain the PostgreSQL connection string used by the application.

For production deployments, configure this variable in the deployment platform rather than committing it to the repository.

### Build

To compile the TypeScript source:

```bash
npm run build
```

To start the compiled application:

```bash
npm start
```

### Tests

Run the test suite with:

```bash
npm test
```

### Deployment

Studylog can be deployed to Vercel.

The production application uses a serverless entry point under:

```text
api/index.ts
```

The database can be hosted using Neon PostgreSQL.

When deploying, configure:

```text
DATABASE_URL
```

as a Vercel environment variable.

Do not commit database credentials or other secrets to Git.

### Database

Studylog uses PostgreSQL for persistent storage.

The application can connect to a remote PostgreSQL database through `DATABASE_URL`, which allows the same database architecture to be used during local development and deployment.

### Security

Do not commit the following to the repository:

* Database connection strings
* Passwords
* Session secrets
* API keys
* Other private credentials

Environment variables should be used for deployment-specific secrets.

### License

Studylog is licensed under the Apache License 2.0.

See [LICENSE](LICENSE) for the full license text.

---

## 日本語

### 概要

Studylogは、学習内容や学習時間、目標、進捗を記録するためのWebアプリケーションです。

学習した内容を継続的に保存し、あとから自分の学習履歴を確認できるようにすることを目的としています。

比較的小さな構成で実装されているため、個人利用だけでなく、コードを読んだり、改造したり、機能を追加したりする用途にも利用できます。

### 主な機能

* ユーザー認証
* 学習データの永続化
* 学習目標の管理
* 学習記録の保存
* PostgreSQLデータベース
* EJSによるサーバーサイドレンダリング
* TypeScriptによるバックエンド
* ExpressによるWebサーバー
* ローカル開発環境
* Vercelへのデプロイ
* Neon PostgreSQLへの対応

### 使用技術

* TypeScript
* Node.js
* Express
* EJS
* PostgreSQL
* Neon
* Vercel

### プロジェクト構成

```text
studylog/
├── api/
│   └── index.ts
├── public/
│   └── ...
├── src/
│   ├── db.ts
│   ├── auth.ts
│   ├── goals.ts
│   ├── studylog-app.ts
│   └── local-server.ts
├── test/
│   └── ...
├── views/
│   └── ...
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

### 必要な環境

* Node.js 20以降
* npm
* PostgreSQLデータベース

PostgreSQLには、Neonを利用できます。

### インストール

リポジトリをcloneします。

```bash
git clone https://github.com/Kenyu-f/studylog.git
cd studylog
```

依存パッケージをインストールします。

```bash
npm install
```

PostgreSQLの接続文字列を環境変数に設定します。

```bash
export DATABASE_URL="postgresql://..."
```

開発サーバーを起動します。

```bash
npm run dev
```

### 環境変数

Studylogでは現在、以下の環境変数を使用します。

```text
DATABASE_URL
```

`DATABASE_URL`には、アプリケーションが使用するPostgreSQLの接続文字列を指定します。

本番環境では、接続文字列をGitリポジトリに保存せず、Vercelなどのデプロイ環境の環境変数として設定してください。

### ビルド

TypeScriptをコンパイルするには、

```bash
npm run build
```

を実行します。

コンパイル済みのアプリケーションを起動するには、

```bash
npm start
```

を実行します。

### テスト

テストを実行するには、

```bash
npm test
```

を実行します。

### デプロイ

StudylogはVercelにデプロイできます。

Vercel用のエントリーポイントは、

```text
api/index.ts
```

です。

データベースにはNeon PostgreSQLを利用できます。

VercelのEnvironment Variablesに、

```text
DATABASE_URL
```

を設定してください。

データベースの認証情報やAPIキーなどをGitにコミットしないでください。

### データベース

Studylogでは、学習データなどの永続的なデータをPostgreSQLに保存します。

`DATABASE_URL`を利用することで、ローカル環境と本番環境の両方からPostgreSQLデータベースへ接続できます。

### セキュリティ

以下の情報をリポジトリにコミットしないでください。

* データベース接続文字列
* パスワード
* セッション用秘密情報
* APIキー
* その他の認証情報

本番環境で必要な秘密情報は、環境変数として設定してください。

### ライセンス

StudylogはApache License 2.0のもとで公開されています。

完全なライセンス本文については、[LICENSE](LICENSE)を参照してください。

---

## 中文

### 项目简介

Studylog 是一个用于记录学习活动、学习目标和学习进度的 Web 应用程序。

它可以保存用户的学习记录，并将这些数据持久化到 PostgreSQL 数据库中，以便之后查看自己的学习历史。

项目采用相对简单的架构，适合个人使用、学习、实验以及进一步开发。

### 主要功能

* 用户身份验证
* 学习数据持久化
* 学习目标管理
* 学习记录
* PostgreSQL 数据库
* 使用 EJS 进行服务器端渲染
* 基于 TypeScript 的后端
* 基于 Express 的 Web 服务器
* 本地开发环境
* 支持部署到 Vercel
* 支持 Neon PostgreSQL

### 使用的技术

* TypeScript
* Node.js
* Express
* EJS
* PostgreSQL
* Neon
* Vercel

### 项目结构

```text
studylog/
├── api/
│   └── index.ts
├── public/
│   └── ...
├── src/
│   ├── db.ts
│   ├── auth.ts
│   ├── goals.ts
│   ├── studylog-app.ts
│   └── local-server.ts
├── test/
│   └── ...
├── views/
│   └── ...
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

### 环境要求

* Node.js 20 或更高版本
* npm
* PostgreSQL 数据库

可以使用 Neon 提供的 PostgreSQL 数据库。

### 安装

首先克隆仓库：

```bash
git clone https://github.com/Kenyu-f/studylog.git
cd studylog
```

安装依赖：

```bash
npm install
```

设置 PostgreSQL 数据库连接字符串：

```bash
export DATABASE_URL="postgresql://..."
```

启动开发服务器：

```bash
npm run dev
```

### 环境变量

Studylog 当前需要以下环境变量：

```text
DATABASE_URL
```

`DATABASE_URL` 应该包含应用程序使用的 PostgreSQL 连接字符串。

在生产环境中，请将该变量配置在部署平台的环境变量中，而不要将数据库连接信息提交到 Git 仓库。

### 构建

编译 TypeScript：

```bash
npm run build
```

启动编译后的应用程序：

```bash
npm start
```

### 测试

运行测试：

```bash
npm test
```

### 部署

Studylog 可以部署到 Vercel。

Vercel 使用以下 Serverless Function 入口：

```text
api/index.ts
```

数据库可以使用 Neon PostgreSQL。

部署时，请在 Vercel 的 Environment Variables 中设置：

```text
DATABASE_URL
```

不要将数据库密码、API Key 或其他秘密信息提交到 Git 仓库。

### 数据库

Studylog 使用 PostgreSQL 保存需要长期保存的数据。

通过 `DATABASE_URL`，应用程序可以连接到远程 PostgreSQL 数据库，因此本地开发环境和生产环境可以使用相同的数据库架构。

### 安全

请不要将以下信息提交到 Git 仓库：

* 数据库连接字符串
* 密码
* Session Secret
* API Key
* 其他私密凭证

生产环境需要的秘密信息应该通过环境变量进行配置。

### 许可证

Studylog 使用 Apache License 2.0 发布。

完整的许可证文本请参阅 [LICENSE](LICENSE)。

---

## Repository

GitHub: https://github.com/Kenyu-f/studylog

