const fetch = require("node-fetch");
const { Octokit } = require("@octokit/rest");
const { decrypt } = require("../utils/crypto");
const { fail } = require("../utils/request");
const { getDay } = require("../utils/day");
const { secret, db, clientId } = require("../config/index");

module.exports = ({ whitelist = [] }) =>
  async function checkAuth(ctx, next) {
    if (getDay() > 91) {
      ctx.body = fail({
        message:
          "本期活动已经结束，请耐心等待下期~ 活动开始报名会第一时间在公众号《力扣加加》同步!",
      });
      return;
    }
    if (whitelist.includes(ctx.path)) await next();
    else {
      if (!ctx.session) {
        ctx.session = {};
      }
      if (ctx.session.user) {
        await next();
      } else {
        // 1. 如果有 token ，则说明是之前种植过的，直接解析（如果是别人伪造的则会解析失败）
        const token = ctx.get("token");

        if (token) {
          const duserStr = decrypt(token);
          if (duserStr) {
            try {
              const duser = JSON.parse(duserStr);
              ctx.session.user = {
                ...duser,
                pay: !!db[duser.login],
              };
              await next();
              return;
            } catch (err) {
              console.log("token 解析失败:", err);
              return;
            }
          }
        }
        // 2. 如果没有 token，就必须有 code，因此这个时候需要拿 code 去 github 登录，取用户的信息。
        const code = ctx.query.code;
        if (!code) {
          ctx.body = fail({ message: "请先登录~", code: 403 });
          return;
        } else if (code.length !== 20) {
          ctx.body = fail({ message: "code 码无效，请重新登录", code: 403 });
          return;
        }
        try {
          // 3. 根据 code  获取用户信息
          const { access_token } = await fetch(
            `https://github.com/login/oauth/access_token?code=${code}&client_id=${clientId}&client_secret=${secret}`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
              },
            }
          ).then((res) => res.json());

          const user = await fetch("https://api.github.com/user", {
            headers: {
              Accept: "application/json",
              Authorization: `token ${access_token}`,
            },
          }).then((res) => res.json());

          // user.login 存在表示登录成功
          if (user.login) {
            // 付费用户
            const pay = !!db[user.login.toLocaleLowerCase()];
            const u = {
              ...user,
              pay,
            };
            // 登录成功将用户加入到会话
            ctx.session.user = u;
            // if (pay) {
            //   try {
            //     const octokit = new Octokit({ auth: process.env.token });

            //     octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
            //       org: "leetcode-pp",
            //       team_slug: "91algo-5",
            //       username: user.login,
            //     });
            //   } catch (err) {
            //     console.log("自动邀请失败：", err);
            //   }
            // }
          }

          await next();
        } catch (err) {
          // 4. 登录过程中出错，会跳转至此
          ctx.body = fail({
            message: err.message || "登录失败， code 码已失效~",
            code: 403,
          });
        }
      }
    }
  };
