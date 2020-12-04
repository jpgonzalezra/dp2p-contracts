const Dai = artifacts.require('Dai');
const DP2PDAI = artifacts.require('DP2PDai');

const { bn, expect, toEvents, signDaiPermit } = require('./helper/index.js');

contract('DP2P', (accounts) => {
  const WEI = bn(web3.utils.toWei('1'));
  const BASE = bn(10000);
  const owner = accounts[1];
  const creator = accounts[2];
  const seller = '0x30837486478fdA93D06da23A8ab354703648C9c7';
  const buyer = accounts[4];
  const agent = accounts[5];

  let dp2pDai;
  let dai;

  const mint = async (beneficiary, amount) => {
    await dai.mint(beneficiary, amount, { from: owner });
  };

  const calcId = (_agent, _seller, _buyer, _fee, _token, _salt) =>
    web3.utils.soliditySha3(
      { t: 'address', v: dp2pDai.address },
      { t: 'address', v: _agent },
      { t: 'address', v: _seller },
      { t: 'address', v: _buyer },
      { t: 'uint256', v: _fee },
      { t: 'address', v: _token },
      { t: 'uint256', v: _salt }
    );

  before('deploy contracts', async function () {
    dai = await Dai.new(5777, { from: owner });
    dp2pDai = await DP2PDAI.new(dai.address, { from: owner });
    dp2pDai.initialize({ from: owner });
    await dp2pDai.newAgent(agent, 500, { from: owner });
    await dp2pDai.setPlatformFee(50, { from: owner });
  });

  describe.skip('Simple flow with DAI permit', () => {
    it('create, deposit with permit', async () => {
      const amount = WEI;
      const nonce = await dai.nonces(seller);
      const id = await calcId(agent, seller, buyer, 500, dai.address, nonce);

      await mint(seller, amount);
      const privKey = Buffer.from(
        '1972c66239e8c11c8c76d554d5ae4e1031404572c3b01e8ed6a360dcf480d11d',
        'hex'
      );
      console.log(seller);
      const { v, r, s } = await signDaiPermit(
        dai,
        dp2pDai.address,
        nonce,
        seller,
        privKey
      );

      const digest = await dai.getDigest(
        seller,
        dp2pDai.address,
        nonce,
        0,
        true
      );
      expect(seller, await dai.getHolder(digest, v, r, s));

      const CreateAndDeposit = await toEvents(
        dp2pDai.createAndDepositWithPermit(
          amount,
          agent,
          buyer,
          nonce,
          v,
          r,
          s,
          {
            from: seller,
          }
        ),
        'CreateAndDeposit'
      );

      expect(CreateAndDeposit._id, id);
      const fee = await dp2pDai.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(
        CreateAndDeposit._balance.add(CreateAndDeposit._platformAmount)
      ).to.eq.BN(amount);

      const escrow = await dp2pDai.escrows(id);
      expect(escrow.balance, toEscrow);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2pDai.platformBalanceByToken(dai.address)).to.eq.BN(
        5000000000000000
      );

      expect(await dai.balanceOf(owner)).to.eq.BN(0);
      expect(await dai.balanceOf(creator)).to.eq.BN(0);
      expect(await dai.balanceOf(agent)).to.eq.BN(0);
      expect(await dai.balanceOf(seller)).to.eq.BN(0);
      expect(await dai.balanceOf(buyer)).to.eq.BN(0);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(await dai.balanceOf(dp2pDai.address)).to.eq.BN(amount);
    });
  });
});
