const Dai = artifacts.require("Dai");
const DP2P = artifacts.require("DP2P");

const { bn, expect, toEvents } = require("./helper/index.js");

contract("DP2P", (accounts) => {
  const WEI = bn(web3.utils.toWei("1"));
  const BASE = bn(10000);
  const owner = accounts[1];
  const creator = accounts[2];
  const agent = accounts[5];
  const agent2 = accounts[6];
  const seller = accounts[3];
  const buyer = accounts[4];

  let dp2p;
  let dai;

  const mintAndApproveTokens = async (beneficiary, amount) => {
    await dai.mint(beneficiary, amount, { from: owner });
    await dai.mintAndApproveTokens(dp2p.address, amount, { from: beneficiary });
  };

  const calcId = (_agent, _seller, _buyer, _fee, _token, _salt) =>
    web3.utils.soliditySha3(
      { t: "address", v: dp2p.address },
      { t: "address", v: _agent },
      { t: "address", v: _seller },
      { t: "address", v: _buyer },
      { t: "uint256", v: _fee },
      { t: "address", v: _token },
      { t: "uint256", v: _salt }
    );

  before("deploy contracts", async function () {
    dai = await Dai.new(3, { from: owner });
    dp2p = await DP2P.new({ from: owner });
    await dp2p.newAgent(agent, 500, { from: owner });
    await dp2p.setPlatformFee(50, { from: owner });
  });

  describe("Simple flow with DAI permite", () => {
    it("create, deposit, and release", async () => {
      const amount = WEI;
      const internalSalt = 999;
      const id = await calcId(
        agent2,
        seller,
        buyer,
        500,
        dai.address,
        internalSalt
      );
      await dp2p.newAgent(agent2, 500, { from: owner });

      await mintAndApproveTokens(seller, amount);
      const CreateAndDeposit = await toEvents(
        dp2p.createAndDeposit(
          amount,
          agent2,
          buyer,
          dai.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "CreateAndDeposit"
      );

      expect(CreateAndDeposit._id, id);
      const fee = await dp2p.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(
        CreateAndDeposit._balance.add(CreateAndDeposit._platformAmount)
      ).to.eq.BN(amount);

      const escrow = await dp2p.escrows(id);
      expect(escrow.balance, toEscrow);
      expect(escrow.agent, agent2);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(dai.address)).to.eq.BN(
        5000000000000000
      );

      expect(await dai.balanceOf(owner)).to.eq.BN(0);
      expect(await dai.balanceOf(creator)).to.eq.BN(0);
      expect(await dai.balanceOf(agent2)).to.eq.BN(0);
      expect(await dai.balanceOf(seller)).to.eq.BN(0);
      expect(await dai.balanceOf(buyer)).to.eq.BN(0);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(await dai.balanceOf(dp2p.address)).to.eq.BN(amount);
    });
  });
});
