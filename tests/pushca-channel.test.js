const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const scripts = ['../js/callable-future.js', '../js/pnotifications.js', '../js/pushca-channel.js']
  .map(path => fs.readFileSync(require.resolve(path), 'utf8'));

// In-memory Pushca channel service answering the commands PushcaClient really builds.
function fakeServer() {
  const channels = new Map(); // id -> {name, members: Map(accountId -> active), messages: []}
  const commands = [];
  const info = (id, withMembers) => {
    const channel = channels.get(id);
    return {
      channel: { id, name: channel.name },
      members: withMembers ? [...channel.members].map(([accountId, active]) =>
        ({ workSpaceId: 'ws', accountId, deviceId: null, applicationId: 'app', active })) : [],
      counter: channel.messages.length, time: 0, read: true
    };
  };
  const handlers = {
    GET_CHANNELS: ({ filter }) => ({
      channels: [...channels.keys()].filter(id => channels.get(id).members.has(filter.accountId)).map(id => info(id, true))
    }),
    GET_CHANNELS_PUBLIC_INFO: ({ ids }) => ({ channels: ids.filter(id => channels.has(id)).map(id => info(id, false)) }),
    ADD_MEMBERS_TO_CHANNEL: ({ channel, filters }) => {
      if (!channels.has(channel.id)) channels.set(channel.id, { name: channel.name, members: new Map(), messages: [] });
      filters.forEach(filter => channels.get(channel.id).members.set(filter.accountId, true));
      return {};
    },
    // Pages of two, newest first; `offset` is the index where the next older page ends.
    GET_CHANNEL_HISTORY: ({ channel, offset }) => {
      const all = channels.get(channel.id).messages;
      const end = offset ?? all.length;
      const start = Math.max(0, end - 2);
      return { messages: all.slice(start, end), offset: start, latest: end === all.length, more: start > 0 };
    },
    SEND_MESSAGE_TO_CHANNEL: ({ channel, message }) => {
      const messageId = `m${channels.get(channel.id).messages.length + 1}`;
      server.push(channel.id, messageId, 'self', message);
      return { messageId };
    },
    MARK_CHANNEL_AS_READ: () => ({})
  };
  const server = {
    channels, commands,
    create(id, name, accounts = []) {
      channels.set(id, { name, members: new Map(accounts.map(account => [account, false])), messages: [] });
    },
    push(channelId, messageId, accountId, body, sendTime = channels.get(channelId).messages.length + 1) {
      channels.get(channelId).messages.push({
        sender: { workSpaceId: 'ws', accountId, deviceId: JSON.stringify({ avatarCode: 'ai-agent' }), applicationId: 'app' },
        channelId, messageId, parentId: null, sendTime, body, mentioned: []
      });
    },
    answer(message) {
      const [id, command, args] = message.split('@@');
      commands.push({ command, args: JSON.parse(args) });
      return { id, body: JSON.stringify({ body: handlers[command](JSON.parse(args)) }) };
    }
  };
  return server;
}

function page({ server = fakeServer(), previousMessageHandler = null } = {}) {
  let nextId = 0;
  const context = vm.createContext({
    window: { location: { href: 'test' }, addEventListener() {}, WebSocket: { OPEN: 1 } },
    console: { log() {}, error() {}, warn() {} },
    crypto: webcrypto, uuid: { v4: () => `uuid-${++nextId}` }, JSON, Date, Promise, Error, Map, setTimeout, clearTimeout,
    isNotEmpty: value => value != null, isArrayNotEmpty: value => Array.isArray(value) && value.length > 0
  });
  scripts.forEach(source => vm.runInContext(source, context));
  const client = vm.runInContext('PushcaClient', context);
  client.ws = { readyState: 1 };
  client.executeWithRepeatOnFailure = async (id, commandWithId) => {
    const answer = server.answer(commandWithId.message);
    return vm.runInContext(`new WaiterResponse(WaiterResponseType.SUCCESS, ${JSON.stringify(answer.body)})`, context);
  };
  client.onChannelMessageHandler = previousMessageHandler;
  const run = code => vm.runInContext(code, context);
  const PushcaChannel = run('PushcaChannel');
  const member = PushcaChannel.createMember('ws', 'anna', 'app', PushcaChannel.Avatar.AI_AGENT);
  const received = [];
  const memberUpdates = [];
  const session = PushcaChannel.open('room-1', member, {
    onMessage: message => received.push(message),
    onMembersChange: members => memberUpdates.push(members)
  });
  const incoming = (channelId, messageId, accountId, body) => client.onChannelMessageHandler(run('ChannelMessage').fromObject({
    sender: { workSpaceId: 'ws', accountId, deviceId: 'device', applicationId: 'app' },
    channelId, messageId, sendTime: 99, body
  }));
  return { server, client, run, PushcaChannel, member, session, received, memberUpdates, incoming };
}

// Values built inside the vm context have that realm's prototypes.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const commandNames = server => server.commands.map(entry => entry.command);

test('joining a missing channel creates it with the account (without device) as member', async () => {
  const p = page();
  same({ ...await p.session.join({ allowCreate: true }) }, { created: true, joined: true });
  const add = p.server.commands.find(entry => entry.command === 'ADD_MEMBERS_TO_CHANNEL');
  same(add.args.channel, { id: 'room-1', name: 'room-1' });
  // ClientFilter.toJSON receives the array index from JSON.stringify, as in free-comments.
  same(add.args.filters, [{ workSpaceId: 'ws', accountId: 'anna', deviceId: null, applicationId: 'app', findAny: false }]);
  assert.ok(p.server.channels.get('room-1').members.has('anna'));
});

test('a missing channel is never created unless allowed', async () => {
  const p = page();
  await assert.rejects(p.session.join(), error => error.code === p.PushcaChannel.CHANNEL_NOT_FOUND
    && /Room room-1 does not exist/.test(error.message));
  assert.ok(!commandNames(p.server).includes('ADD_MEMBERS_TO_CHANNEL'));
  assert.ok(!p.server.channels.has('room-1'));
});

test('an existing channel is joined without being allowed to create one', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['bot']);
  same({ ...await p.session.join() }, { created: false, joined: true });
  assert.ok(p.server.channels.get('room-1').members.has('anna'));
});

test('a member is not added again', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['anna', 'bot']);
  same({ ...await p.session.join() }, { created: false, joined: false });
  assert.ok(!commandNames(p.server).includes('ADD_MEMBERS_TO_CHANNEL'));
  assert.equal(p.session.channel.name, 'Support');
  same(p.session.memberList().map(member => member.accountId).sort(), ['anna', 'bot']);
});

test('joining an existing channel keeps its name', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['bot']);
  same({ ...await p.session.join() }, { created: false, joined: true });
  const add = p.server.commands.find(entry => entry.command === 'ADD_MEMBERS_TO_CHANNEL');
  same(add.args.channel, { id: 'room-1', name: 'Support' });
});

test('history pages older messages until the server has no more and never repeats one', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['anna']);
  ['a', 'b', 'c', 'd', 'e'].forEach((body, index) => p.server.push('room-1', `m${index + 1}`, 'bot', body));
  same((await p.session.join()).joined, false);
  same((await p.session.loadLatest()).map(message => message.body), ['d', 'e']);
  assert.equal(p.session.hasOlder, true);
  same((await p.session.loadOlder()).map(message => message.body), ['b', 'c']);
  same((await p.session.loadOlder()).map(message => message.body), ['a']);
  assert.equal(p.session.hasOlder, false);
  same(await p.session.loadOlder(), []);
  // A reconnect refetches the newest page: only messages missed meanwhile are returned.
  p.server.push('room-1', 'm6', 'bot', 'f');
  same((await p.session.loadLatest()).map(message => message.body), ['f']);
});

test('history reads the avatar senders announce in their device id', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['anna']);
  p.server.push('room-1', 'm1', 'anna', 'hi');
  await p.session.join();
  const [message] = await p.session.loadLatest();
  assert.equal(p.PushcaChannel.avatarOf(message.sender), 'ai-agent');
});

test('pushes are routed to the session of their channel once; other channels reach the previous handler', async () => {
  const others = [];
  const p = page({ previousMessageHandler: message => others.push(message.channelId) });
  p.incoming('room-1', 'x1', 'bot', 'hello');
  p.incoming('room-1', 'x1', 'bot', 'hello');
  p.incoming('room-2', 'x2', 'bot', 'elsewhere');
  same(p.received.map(message => message.messageId), ['x1']);
  same(others, ['room-2']);
});

test('a sent message echoed before the send response is reported as echoed, not delivered twice', async () => {
  const p = page();
  await p.session.join({ allowCreate: true });
  const send = p.session.send('first line\nsecond line');
  p.incoming('room-1', 'm1', 'anna', 'first line\nsecond line'); // the push wins the race
  const result = await send;
  assert.equal(result.echoed, true);
  assert.equal(result.message.messageId, 'm1');
  assert.equal(p.received.length, 1);

  const second = await p.session.send('another');
  assert.equal(second.echoed, false);
  assert.equal(second.message.messageId, 'm2');
  assert.equal(second.message.sender.accountId, 'anna');
  p.incoming('room-1', 'm2', 'anna', 'another'); // a late echo is ignored
  assert.equal(p.received.length, 1);
});

test('failed commands reject with a readable error', async () => {
  const p = page();
  p.client.executeWithRepeatOnFailure = async () =>
    p.run(`new WaiterResponse(WaiterResponseType.ERROR, 'timeout')`);
  await assert.rejects(p.session.join(), /Could not load the channel details/);
  await assert.rejects(p.session.send('hello'), /The message was not sent/);
});

test('presence events update member activity', async () => {
  const p = page();
  p.server.create('room-1', 'Support', ['anna', 'bot']);
  await p.session.join();
  const event = type => p.run('ChannelEvent').fromJSON({
    type, channelId: 'room-1', time: 1,
    actor: { workSpaceId: 'ws', accountId: 'bot', deviceId: JSON.stringify({ avatarCode: 'ai-agent' }), applicationId: 'app' }
  });
  p.client.onChannelEventHandler(event('MEMBER_ACTIVE'));
  let bot = p.memberUpdates.at(-1).find(member => member.accountId === 'bot');
  same({ ...bot }, { accountId: 'bot', active: true, avatar: 'ai-agent' });
  p.client.onChannelEventHandler(event('MEMBER_NOT_ACTIVE'));
  bot = p.memberUpdates.at(-1).find(member => member.accountId === 'bot');
  assert.equal(bot.active, false);
});

test('avatar defaults to human manager for unknown or missing device details', () => {
  const p = page();
  assert.equal(p.PushcaChannel.avatarOf({ deviceId: 'plain-device' }), 'human-manager');
  assert.equal(p.PushcaChannel.avatarOf({ deviceId: JSON.stringify({ avatarCode: 'robot' }) }), 'human-manager');
  assert.equal(p.PushcaChannel.avatarOf(null), 'human-manager');
  assert.equal(p.PushcaChannel.avatarOf(p.member), 'ai-agent');
});

test('a channel can only be opened once', () => {
  const p = page();
  assert.throws(() => p.PushcaChannel.open('room-1', p.member), /already open/);
});
