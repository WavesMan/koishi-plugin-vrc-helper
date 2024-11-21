const { Context } = require('koishi');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 文件路径
const dataPath = path.resolve('./src/usr_data.json');
let userData = {};

// 加载或初始化用户数据
if (fs.existsSync(dataPath)) {
  userData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

// 保存用户数据函数
function saveUserData() {
  fs.writeFileSync(dataPath, JSON.stringify(userData, null, 2), 'utf8');
}

module.exports = (ctx) => {
  const pendingConfirmations = new Map();

  // 登录命令
  ctx.command('login vrc <username:string> <password:string>', '登录VRChat账号')
    .action(async ({ session }, username, password) => {
      if (!username || !password) {
        return '请提供用户名和密码，格式为：login vrc <用户名> <密码>';
      }

      if (session.channelId) {
        pendingConfirmations.set(session.userId, { username, password });
        return '在群聊内登陆VRChat账号可能会导致vrc账号密码泄露，确认继续登陆请回复 Yes，否则请回复 No。';
      }

      return await performLogin(session, username, password);
    });

  // 监听用户确认消息
  ctx.middleware(async (session, next) => {
    const confirmation = pendingConfirmations.get(session.userId);
    if (!confirmation) return next();

    const content = session.content?.trim().toLowerCase();
    if (content === 'yes') {
      pendingConfirmations.delete(session.userId);
      return await performLogin(session, confirmation.username, confirmation.password);
    } else if (content === 'no') {
      pendingConfirmations.delete(session.userId);
      return '已取消登录操作。';
    }
  });

  // 登录逻辑
  async function performLogin(session, username, password) {
    try {
      const response = await axios.post('https://api.vrchat.cloud/api/1/auth/user', {}, {
        auth: { username, password },
      });

      if (response.data.requiresTwoFactorAuth) {
        session.user['vrc-login'] = { username, password };
        return '2FA验证已启用，请输入验证码：2fa <验证码>';
      }

      const cookies = response.headers['set-cookie'];
      userData[session.userId] = {
        qqId: session.userId,
        vrcUsername: username,
        cookies,
      };
      saveUserData();

      return '登录成功！VRChat账号已与您的QQ账号绑定。';
    } catch (error) {
      return `登录失败：${error.response?.data?.error?.message || error.message}`;
    }
  }

  // 处理2FA验证
  ctx.command('2fa <code:string>', '输入2FA验证码')
    .action(async ({ session }, code) => {
      const loginInfo = session.user['vrc-login'];
      if (!loginInfo) {
        return '请先使用 "login vrc" 命令登录！';
      }

      try {
        const response = await axios.post('https://api.vrchat.cloud/api/1/auth/twofactor', {
          code,
        }, {
          auth: { username: loginInfo.username, password: loginInfo.password },
        });

        const cookies = response.headers['set-cookie'];
        userData[session.userId] = {
          qqId: session.userId,
          vrcUsername: loginInfo.username,
          cookies,
        };
        saveUserData();

        delete session.user['vrc-login'];
        return '2FA验证成功，登录完成！VRChat账号已与您的QQ账号绑定。';
      } catch (error) {
        return `2FA验证失败：${error.response?.data?.error?.message || error.message}`;
      }
    });

  // 获取用户自己的VRChat信息
  ctx.command('我的vrc', '获取自己的VRChat信息')
    .action(async ({ session }) => {
      const userInfo = userData[session.userId];
      if (!userInfo) {
        return '您尚未登录VRChat账号，请先使用 "login vrc" 命令登录。';
      }

      try {
        // 使用用户的Cookie请求VRChat API获取用户信息
        const response = await axios.get('https://api.vrchat.cloud/api/1/auth/user', {
          headers: {
            Cookie: userInfo.cookies.join('; '),
          },
        });

        const { displayName, currentAvatarThumbnailImageUrl } = response.data;
        return [
          `您的VRChat昵称：${displayName}`,
          `[CQ:image,file=${currentAvatarThumbnailImageUrl}]`, // 发送头像
        ].join('\n');
      } catch (error) {
        return `获取VRChat信息失败：${error.response?.data?.error?.message || error.message}`;
      }
    });
};
