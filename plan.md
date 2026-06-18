# Plan: 修复登录身份选择逻辑

## 目标
一个账号既可以当买家也可以当开发者，登录时选择身份（跟 Boss 直聘一样）。

## 改动

### 1. 注册页面
- 去掉角色选择器，只保留用户名/邮箱/密码

### 2. 登录页面
- 加角色选择：买家 / 开发者
- 登录时把 role 编码进 SID

### 3. 后端
- `register` 去掉 role 参数
- `login` 返回 role（从 SID 解码）
- `getUserFromSid` 从 SID 解码 role（不从 DB 读）

### 4. 数据库
- users 表保留 role 字段但不再使用

## 文件
- `frontend/index.html`
- `src/routes/users.ts`

## 验证
- 注册一个账号
- 登录选买家 → 买家界面
- 退出，登录选开发者 → 开发者界面
