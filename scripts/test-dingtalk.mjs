/**
 * 最小化钉钉 Stream 连接测试
 * 用法: node scripts/test-dingtalk.mjs
 * 
 * 直接用 SDK 连接钉钉，不经过任何业务代码，
 * 用来排查是 SDK 层面的问题还是我们代码的问题。
 */
import { DWClient, TOPIC_ROBOT, EventAck } from 'dingtalk-stream-sdk-nodejs';

const CLIENT_ID = 'dingdvpqpmxfegkmx155';
const CLIENT_SECRET = 'Shf3XHYj7MmhGsVItKzlaynt39Cef_GSz7L0XO-7A8Rav2q6CMqid4CPGIeA52B_';

console.log('=== 钉钉 Stream 连接测试 ===');
console.log(`ClientID: ${CLIENT_ID}`);
console.log(`时间: ${new Date().toISOString()}`);
console.log('');

const client = new DWClient({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// 关闭 SDK 内部 debug 日志
client.debug = false;

console.log('[1] 注册 CALLBACK 监听器...');
client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
  console.log('');
  console.log('========================================');
  console.log('[收到消息!]', new Date().toISOString());
  console.log('  type:', downstream.type);
  console.log('  topic:', downstream.headers?.topic);
  console.log('  messageId:', downstream.headers?.messageId);
  try {
    const body = JSON.parse(downstream.data);
    console.log('  msgId:', body.msgId);
    console.log('  senderId:', body.senderId);
    console.log('  senderStaffId:', body.senderStaffId);
    console.log('  senderNick:', body.senderNick);
    console.log('  msgtype:', body.msgtype);
    if (body.text) console.log('  text:', body.text.content);
  } catch (e) {
    console.log('  raw data:', downstream.data);
  }
  console.log('========================================');
  console.log('');

  // 发送 ACK
  try {
    client.send(downstream.headers?.messageId || '', { status: EventAck.SUCCESS });
    console.log('[ACK 已发送]');
  } catch (err) {
    console.error('[ACK 发送失败]', err.message);
  }
});

// 也监听所有事件（用 registerAllEventListener）
const origOnEvent = client.onEventReceived;
client.registerAllEventListener((msg) => {
  console.log('[EVENT]', msg.type, msg.headers?.topic, msg.headers?.messageId);
  return { status: EventAck.SUCCESS };
});

console.log('[2] 正在连接钉钉...');
console.log('  subscriptions:', JSON.stringify(client.getConfig().subscriptions));

try {
  await client.connect();
  console.log('[3] connect() 已返回');
  console.log('  client.connected:', client.connected);
  console.log('  client.registered:', client.registered);
  console.log('  client.reconnecting:', client.reconnecting);
  console.log('  socket exists:', !!client.socket);
  console.log('  socket.readyState:', client.socket?.readyState);

  // 等待 registered
  let waited = 0;
  while (!client.registered && waited < 10000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }
  console.log(`[4] 等待 ${waited}ms 后:`);
  console.log('  client.connected:', client.connected);
  console.log('  client.registered:', client.registered);
  console.log('  socket.readyState:', client.socket?.readyState);

  if (client.registered) {
    console.log('');
    console.log('✅ 连接成功! 请在钉钉给机器人发消息...');
    console.log('   (按 Ctrl+C 退出)');
    console.log('');
  } else {
    console.log('');
    console.log('❌ 连接后未收到 REGISTERED，可能有问题');
    console.log('');
  }

  // 每 10 秒打印一次状态
  setInterval(() => {
    console.log(`[状态] ${new Date().toISOString()} connected=${client.connected} registered=${client.registered} socketState=${client.socket?.readyState}`);
  }, 10000);

} catch (err) {
  console.error('[连接失败]', err);
  process.exit(1);
}
