const sigUtil = require('eth-sig-util');
const { promisify } = require('util');
const BN = web3.utils.BN;
const expect = require('chai').use(require('bn-chai')(BN)).expect;

module.exports.expect = expect;
module.exports.address0x = '0x0000000000000000000000000000000000000000';
module.exports.bn = (number) => {
  return web3.utils.toBN(number);
};
module.exports.maxUint = (base) => {
  return this.bn('2').pow(this.bn(base)).sub(this.bn('1'));
};
module.exports.random32bn = () => {
  return this.bn(this.random32());
};
module.exports.random32 = () => {
  return web3.utils.randomHex(32);
};
// the promiseFunction should be a function
module.exports.tryCatchRevert = async (
  promise,
  message,
  headMsg = 'revert '
) => {
  if (message === '') {
    headMsg = headMsg.slice(0, -1);
    console.log(
      '    \u001b[93m\u001b[2m\u001b[1m⬐ Warning:\u001b[0m\u001b[30m\u001b[1m There is an empty revert/require message'
    );
  }
  try {
    if (promise instanceof Function) await promise();
    else await promise;
  } catch (error) {
    assert(
      error.message.search(headMsg + message) >= 0 ||
        process.env.SOLIDITY_COVERAGE,
      'Expected a revert \'' +
        headMsg +
        message +
        '\', got \'' +
        error.message +
        '\' instead'
    );
    return;
  }
  throw new Error('Expected throw not received');
};
module.exports.toEvents = async (tx, ...events) => {
  if (tx instanceof Promise) tx = await tx;

  const logs = tx.logs;

  let eventObjs = [].concat.apply(
    [],
    events.map((event) => logs.filter((log) => log.event === event))
  );

  if (eventObjs.length === 0 || eventObjs.some((x) => x === undefined)) {
    console.log('\t\u001b[91m\u001b[2m\u001b[1mError: The event dont find');
    assert.fail();
  }
  eventObjs = eventObjs.map((x) => x.args);
  return eventObjs.length === 1 ? eventObjs[0] : eventObjs;
};
module.exports.fixSignature = (signature) => {
  // in geth its always 27/28, in ganache its 0/1. Change to 27/28 to prevent
  // signature malleability if version is 0/1
  // see https://github.com/ethereum/go-ethereum/blob/v1.8.23/internal/ethapi/api.go#L465
  let v = parseInt(signature.slice(130, 132), 16);
  if (v < 27) v += 27;

  const vHex = v.toString(16);
  return signature.slice(0, 130) + vHex;
};
module.exports.signDaiPermit = async (
  dai,
  dp2pWrapper,
  nonce,
  signer,
  privateKey
) => {
  const domainSchema = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];

  const permitSchema = [
    { name: 'holder', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'allowed', type: 'bool' },
  ];

  const domainData = {
    name: 'Dai Stablecoin',
    version: '1',
    chainId: 5777,
    verifyingContract: dai.address,
  };

  const message = {
    holder: signer,
    spender: dp2pWrapper,
    nonce: nonce,
    expiry: 0,
    allowed: true,
  };
  const typedData = {
    types: {
      EIP712Domain: domainSchema,
      Permit: permitSchema,
    },
    primaryType: 'Permit',
    domain: domainData,
    message,
  };

  const msgParams = { data: typedData };
  const permitSig = sigUtil.signTypedData_v4(privateKey, msgParams).slice(2);

  const r = `0x${permitSig.slice(0, 64)}`;
  const s = `0x${permitSig.slice(64, 128)}`;
  const v = parseInt(permitSig.slice(128, 130), 16);

  return { r, s, v };
};

const advanceBlock = () => {
  return promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_mine',
    id: new Date().getTime(),
  });
};

// Returns the time of the last mined block in seconds
module.exports.latest = async () => {
  const block = await web3.eth.getBlock('latest');
  return new BN(block.timestamp);
};

module.exports.latestBlock = async () => {
  const block = await web3.eth.getBlock('latest');
  return new BN(block.number);
};

// Increases ganache time by the passed duration in seconds
module.exports.increase = async (duration) => {
  if (!BN.isBN(duration))
    duration = new BN(duration);

  if (duration.isNeg())
    throw Error(`Cannot increase time by a negative amount (${duration})`);

  await promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [duration.toNumber()],
    id: new Date().getTime(),
  });

  await advanceBlock();
};

/**
 * Beware that due to the need of calling two separate ganache methods and rpc calls overhead
 * it's hard to increase time precisely to a target point so design your test to tolerate
 * small fluctuations from time to time.
 *
 * @param target time in seconds
 */
module.exports.increaseTo = async (target) => {
  if (!BN.isBN(target))
    target = new BN(target);

  const now = await this.latest();

  if (target.lt(now))
    throw Error(
      `Cannot increase current time (${now}) to a moment in the past (${target})`
    );
  const diff = target.sub(now);
  return this.increase(diff);
};

module.exports.duration = {
  seconds: function (val) {
    return new BN(val);
  },
  minutes: function (val) {
    return new BN(val).mul(this.seconds('60'));
  },
  hours: function (val) {
    return new BN(val).mul(this.minutes('60'));
  },
  days: function (val) {
    return new BN(val).mul(this.hours('24'));
  },
  weeks: function (val) {
    return new BN(val).mul(this.days('7'));
  },
  years: function (val) {
    return new BN(val).mul(this.days('365'));
  },
};
