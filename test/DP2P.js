const TestToken = artifacts.require("TestToken");
const DP2P = artifacts.require("DP2P");

const {
  bn,
  expect,
  toEvents,
  tryCatchRevert,
  address0x,
  maxUint,
  random32,
  increase,
  duration,
  fixSignature,
} = require("./helper/index.js");

contract("DP2P", (accounts) => {
  const WEI = bn(web3.utils.toWei("1"));
  const MAX_PLATFORM_FEE = 100;
  const BASE = bn(10000);
  const owner = accounts[1];
  const creator = accounts[2];
  const agent = accounts[5];
  const agent2 = accounts[6];
  const seller = accounts[3];
  const buyer = accounts[4];

  let prevBalOwner = 0;
  let prevBalCreator = 0;
  let prevBalanceSeller = 0;
  let prevBalanceBuyer = 0;
  let prevBalAgent = 0;
  let prevBalEscrow = 0;
  let prevBalTokenEscrow = 0;
  let prevPlatformBalance = 0;

  let dp2p;
  let erc20;

  let salt = 0;
  let basicEscrow;

  const mintAndApproveTokens = async (beneficiary, amount) => {
    await erc20.mint(beneficiary, amount, { from: owner });
    await erc20.approve(dp2p.address, amount, { from: beneficiary });
  };

  const updateBalances = async (id) => {
    prevBalOwner = await erc20.balanceOf(owner);
    prevBalCreator = await erc20.balanceOf(creator);
    prevBalAgent = await erc20.balanceOf(agent);
    prevBalanceSeller = await erc20.balanceOf(seller);
    prevBalanceBuyer = await erc20.balanceOf(buyer);

    const escrow = await dp2p.escrows(id);
    prevBalEscrow = escrow.balance;
    prevBalTokenEscrow = await erc20.balanceOf(dp2p.address);
    prevPlatformBalance = await dp2p.platformBalanceByToken(erc20.address);
  };

  const calcId = (_agent, _seller, _buyer, _fee, _token, _limit, _salt) =>
    web3.utils.soliditySha3(
      { t: "address", v: dp2p.address },
      { t: "address", v: _agent },
      { t: "address", v: _seller },
      { t: "address", v: _buyer },
      { t: "uint128", v: _fee },
      { t: "address", v: _token },
      { t: "uint128", v: _limit },
      { t: "uint256", v: _salt }
    );

  const createBasicEscrow = async (amount = WEI) => {
    basicEscrow.salt = ++salt;
    await mintAndApproveTokens(seller, amount);
    const CreateAndDeposit = await toEvents(
      dp2p.createAndDeposit(
        amount,
        basicEscrow.agent,
        basicEscrow.buyer,
        basicEscrow.token,
        0,
        basicEscrow.salt,
        {
          from: seller,
        }
      ),
      "CreateAndDeposit"
    );
    const fee = await dp2p.agentFeeByAgentAddress(basicEscrow.agent);
    const id = await calcId(
      basicEscrow.agent,
      basicEscrow.seller,
      basicEscrow.buyer,
      fee,
      basicEscrow.token,
      0,
      basicEscrow.salt
    );
    expect(CreateAndDeposit._id, id);
    return id;
  };

  before("deploy contracts", async function () {
    erc20 = await TestToken.new({ from: owner });
    dp2p = await DP2P.new({ from: owner });
    await dp2p.newAgent(agent, 500, { from: owner });

    await dp2p.setPlatformFee(50, { from: owner });

    basicEscrow = {
      agent,
      seller,
      buyer,
      token: erc20.address,
      limit: 0,
      salt,
    };
  });

  describe("setPlataforFee", function () {
    it("set 0% platform fee", async () => {
      const fee = bn(0);
      const setFeeEvent = await toEvents(
        dp2p.setPlatformFee(fee, { from: owner }),
        "SetFee"
      );

      expect(setFeeEvent._fee).to.eq.BN(fee);
      expect(await dp2p.platformFee()).to.eq.BN(fee);
    });
    it("set max platform fee allowed", async () => {
      const maxFeeAllowed = MAX_PLATFORM_FEE;
      const setFeeEvent = await toEvents(
        dp2p.setPlatformFee(maxFeeAllowed, { from: owner }),
        "SetFee"
      );

      expect(setFeeEvent._fee).to.eq.BN(maxFeeAllowed);
      expect(await dp2p.platformFee()).to.eq.BN(maxFeeAllowed);
    });
    it("should be fail, set fee > MAX_PLATFORM_FEE", async function () {
      const maxFeeAllowed = MAX_PLATFORM_FEE;
      const wrongFee = maxFeeAllowed + 1;
      await tryCatchRevert(
        () => dp2p.setPlatformFee(wrongFee, { from: owner }),
        "setPlatformFee: invalid-fee"
      );
      await tryCatchRevert(
        () => dp2p.setPlatformFee(maxUint(256), { from: owner }),
        "setPlatformFee: invalid-fee"
      );
    });
  });
  describe("onlyOwner", async function () {
    it("not owner want to set platform fee", async function () {
      await tryCatchRevert(
        () => dp2p.setPlatformFee(0, { from: creator }),
        "Owneable: The owner should be the sender"
      );
    });
    it("not owner want to withdraw tokens", async function () {
      await tryCatchRevert(
        () =>
          dp2p.platformWithdraw([erc20.address], address0x, {
            from: creator,
          }),
        "Owneable: The owner should be the sender"
      );
    });
  });
  describe("platformWithdraw", function () {
    it("platform balance withdraw", async () => {
      const id = await createBasicEscrow();
      const fee = await dp2p.platformFee();
      const platatormFee = WEI.mul(fee).div(BASE);
      await updateBalances(id);

      await dp2p.platformWithdraw([erc20.address], creator, {
        from: owner,
      });

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.sub(platatormFee)
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(
        prevBalCreator.add(platatormFee)
      );
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(platatormFee)
      );
    });
    it("want to withdraw to invalid address", async function () {
      await tryCatchRevert(
        () =>
          dp2p.platformWithdraw([erc20.address], address0x, {
            from: owner,
          }),
        "platformWithdraw: error-transfer"
      );
    });
  });
  describe("operations non-escrow", function () {
    it("withdraw to buyer non-escrow", async () => {
      const id = random32();
      const sellerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.seller)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, sellerSignature, {
            from: seller,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
    });
    it("cancel an escrow non-existent", async () => {
      await tryCatchRevert(
        () => dp2p.cancel(random32(), { from: agent }),
        "cancel: invalid-sender"
      );
    });
  });
  describe("createAndDeposit", () => {
    it("create escrow and deposit", async () => {
      const amount = WEI;
      const internalSalt = 999;
      await mintAndApproveTokens(seller, amount);
      const id = await calcId(
        agent2,
        seller,
        buyer,
        500,
        erc20.address,
        0,
        internalSalt
      );
      await updateBalances(id);
      await dp2p.newAgent(agent2, 500, { from: owner });

      const CreateAndDeposit = await toEvents(
        dp2p.createAndDeposit(
          amount,
          agent2,
          buyer,
          erc20.address,
          0,
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

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent2)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("create two escrows with the same id", async () => {
      const amount = WEI;
      await tryCatchRevert(
        () =>
          dp2p.createAndDeposit(amount, agent2, buyer, erc20.address, 0, 999, {
            from: seller,
          }),
        "createAndDeposit: invalid-escrow"
      );
    });
    it("create escrow and deposit tokens", async () => {
      const amount = WEI;

      await mintAndApproveTokens(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        0,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        dp2p.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          0,
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

      const escrow = await dp2p.escrows(id);

      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("deposit 0 amount in an escrow", async () => {
      const amount = bn(0);

      await mintAndApproveTokens(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        0,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        dp2p.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          0,
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
      expect(CreateAndDeposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await dp2p.escrows(id);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(prevBalTokenEscrow);
    });
    it("deposit higth amount in an escrow", async () => {
      const amount = maxUint(240);

      await mintAndApproveTokens(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        0,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        dp2p.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          0,
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

      const escrow = await dp2p.escrows(id);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
  });
  describe("releaseWithSellerSignature", () => {
    it("release escrow from seller", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const sellerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.seller)
      );
      const ReleaseWithSellerSignature = await toEvents(
        dp2p.releaseWithSellerSignature(id, sellerSignature, {
          from: buyer,
        }),
        "ReleaseWithSellerSignature"
      );

      expect(ReleaseWithSellerSignature._id, id);
      expect(ReleaseWithSellerSignature._sender, seller);
      expect(ReleaseWithSellerSignature._to, buyer);

      expect(ReleaseWithSellerSignature._toAmount).to.eq.BN(toAmount);
      expect(ReleaseWithSellerSignature._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterRelease = await dp2p.escrows(id);
      expect(escrowAfterRelease.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("release escrow from seller after buyer take over it", async () => {
      const internalSalt = 1000;
      await mintAndApproveTokens(seller, WEI);
      const limit = 2;
      const id = await calcId(
        agent2,
        seller,
        address0x, // buyer
        500,
        erc20.address,
        limit,
        internalSalt
      );
      await dp2p.createAndDeposit(
        WEI,
        agent2,
        address0x, // buyer
        erc20.address,
        limit,
        internalSalt,
        {
          from: seller,
        }
      );
      await updateBalances(id);

      let escrow = await dp2p.escrows(id);
      expect(address0x).equal(escrow.buyer);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const EscrowComplete = await toEvents(
        dp2p.takeOverAsBuyer(id, {
          from: buyer,
        }),
        "EscrowComplete"
      );
      escrow = await dp2p.escrows(id);
      expect(buyer).equal(escrow.buyer);
      expect(EscrowComplete._id, id);
      expect(EscrowComplete._buyer, buyer);

      const sellerSignature = fixSignature(await web3.eth.sign(id, seller));
      const prevBalanceAgent2 = await erc20.balanceOf(agent2);
      const ReleaseWithSellerSignature = await toEvents(
        dp2p.releaseWithSellerSignature(id, sellerSignature, {
          from: buyer,
        }),
        "ReleaseWithSellerSignature"
      );

      expect(ReleaseWithSellerSignature._id, id);
      expect(ReleaseWithSellerSignature._sender, seller);
      expect(ReleaseWithSellerSignature._to, buyer);

      expect(ReleaseWithSellerSignature._toAmount).to.eq.BN(toAmount);
      expect(ReleaseWithSellerSignature._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect((await erc20.balanceOf(agent2)).sub(prevBalanceAgent2)).to.eq.BN(
        toAgent
      );
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterRelease = await dp2p.escrows(id);
      expect(escrowAfterRelease.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("revert, can not execute takeOverAsBuyer because the limit time is over", async () => {
      const internalSalt = 1000;
      await mintAndApproveTokens(seller, WEI);
      const limit = 1;
      const id = await calcId(
        agent,
        seller,
        address0x, // buyer
        500,
        erc20.address,
        limit,
        internalSalt
      );
      await dp2p.createAndDeposit(
        WEI,
        agent,
        address0x, // buyer
        erc20.address,
        limit,
        internalSalt,
        {
          from: seller,
        }
      );
      await updateBalances(id);
      await increase(duration.hours(2));

      let escrow = await dp2p.escrows(id);
      expect(address0x).equal(escrow.buyer);

      await tryCatchRevert(
        () =>
          dp2p.takeOverAsBuyer(id, {
            from: buyer,
          }),
        "takeOverAsBuyer: limit-finished"
      );
    });
    it("revert release incomplete escrow from seller", async () => {
      const internalSalt = 1001;
      await mintAndApproveTokens(seller, WEI);
      const id = await calcId(
        agent2,
        seller,
        address0x, // buyer
        500,
        erc20.address,
        0,
        internalSalt
      );
      await dp2p.createAndDeposit(
        WEI,
        agent2,
        address0x, // buyer
        erc20.address,
        0,
        internalSalt,
        {
          from: seller,
        }
      );
      await updateBalances(id);

      const escrow = await dp2p.escrows(id);
      expect(address0x).equal(escrow.buyer);

      const sellerSignature = fixSignature(await web3.eth.sign(id, seller));
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, sellerSignature, {
            from: buyer,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
    });

    it("try to release escrow from buyer with incorrect seller signature", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);

      const sellerSignature = fixSignature(
        await web3.eth.sign("incorrect seller signatura", basicEscrow.seller)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, sellerSignature, {
            from: buyer,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
    });
    it("revert release escrow, signature invalid (buyer sign)", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const buyerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.buyer)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, buyerSignature, {
            from: buyer,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
    });
    it("revert release escrow, the signature was correct but the sender was not buyer", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const sellerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.seller)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, sellerSignature, {
            from: agent,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithSellerSignature(id, sellerSignature, {
            from: seller,
          }),
        "releaseWithSellerSignature: invalid-sender-or-signature"
      );
    });
  });
  describe("releaseWithAgentSignature", () => {
    it("release escrow from buyer with agent signature", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);

      const agentSignature = fixSignature(await web3.eth.sign(id, agent));
      const ReleaseWithAgentSignature = await toEvents(
        dp2p.releaseWithAgentSignature(id, agentSignature, {
          from: buyer,
        }),
        "ReleaseWithAgentSignature"
      );

      expect(ReleaseWithAgentSignature._id, id);
      expect(ReleaseWithAgentSignature._sender, seller);
      expect(ReleaseWithAgentSignature._to, buyer);

      const toAmount = amount.sub(toAgent);
      expect(ReleaseWithAgentSignature._toAmount).to.eq.BN(toAmount);
      expect(ReleaseWithAgentSignature._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterRelease = await dp2p.escrows(id);
      expect(escrowAfterRelease.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("try to release escrow from buyer with incorrect agent signature", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const agentSignature = fixSignature(
        await web3.eth.sign("incorrect agent signatura", basicEscrow.agent)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithAgentSignature(id, agentSignature, {
            from: buyer,
          }),
        "releaseWithAgentSignature: invalid-sender-or-signature"
      );
    });
    it("revert release escrow, signature invalid (buyer sign)", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const buyerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.buyer)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithAgentSignature(id, buyerSignature, {
            from: buyer,
          }),
        "releaseWithAgentSignature: invalid-sender-or-signature"
      );
    });
    it("revert release escrow, the signature was correct but the sender was not buyer", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithAgentSignature(id, agentSignature, {
            from: agent,
          }),
        "releaseWithAgentSignature: invalid-sender-or-signature"
      );
      await tryCatchRevert(
        () =>
          dp2p.releaseWithAgentSignature(id, agentSignature, {
            from: seller,
          }),
        "releaseWithAgentSignature: invalid-sender-or-signature"
      );
    });
  });
  describe("resolveDisputeBuyer", () => {
    it("resolveDisputeBuyer from agent", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const DisputeResolved = await toEvents(
        dp2p.resolveDisputeBuyer(id, agentSignature, { from: buyer }),
        "DisputeResolved"
      );

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      expect(DisputeResolved._toAmount).to.eq.BN(toAmount);
      expect(DisputeResolved._toAgent).to.eq.BN(toAgent);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterDispute = await dp2p.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("resolveDisputeBuyer from owner", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;

      const DisputeResolved = await toEvents(
        dp2p.resolveDisputeBuyer(id, "0x", { from: owner }),
        "DisputeResolved"
      );

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      expect(DisputeResolved._toAmount).to.eq.BN(amount);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(amount)
      );

      const escrowAfterDispute = await dp2p.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("revert, the signature was correct but the sender was not buyer", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      await tryCatchRevert(
        () =>
          dp2p.resolveDisputeBuyer(id, agentSignature, {
            from: agent,
          }),
        "resolveDispute: invalid-sender"
      );
      await tryCatchRevert(
        () =>
          dp2p.resolveDisputeBuyer(id, agentSignature, {
            from: seller,
          }),
        "resolveDispute: invalid-sender"
      );
    });
  });
  describe("resolveDisputeSeller", () => {
    it("resolveDisputeSeller from agent", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const DisputeResolved = await toEvents(
        dp2p.resolveDisputeSeller(id, agentSignature, { from: seller }),
        "DisputeResolved"
      );

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      expect(DisputeResolved._toAmount).to.eq.BN(toAmount);
      expect(DisputeResolved._toAgent).to.eq.BN(toAgent);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(toAmount)
      );

      const escrowAfterDispute = await dp2p.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("resolveDisputeSeller from owner", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await dp2p.escrows(id);
      const amount = escrow.balance;

      const DisputeResolved = await toEvents(
        dp2p.resolveDisputeSeller(id, "0x", { from: owner }),
        "DisputeResolved"
      );

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      expect(DisputeResolved._toAmount).to.eq.BN(amount);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(amount)
      );

      const escrowAfterDispute = await dp2p.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("revert, the signature was correct but the sender was not buyer", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      await tryCatchRevert(
        () =>
          dp2p.resolveDisputeSeller(id, agentSignature, {
            from: agent,
          }),
        "resolveDispute: invalid-sender"
      );
      await tryCatchRevert(
        () =>
          dp2p.resolveDisputeSeller(id, agentSignature, {
            from: buyer,
          }),
        "resolveDispute: invalid-sender"
      );
    });
  });
  describe("cancel", () => {
    it("agent cancel an escrow", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const Cancel = await toEvents(dp2p.cancel(id, { from: agent }), "Cancel");

      expect(Cancel._id, id);
      expect(Cancel._amount).to.eq.BN(prevBalEscrow);

      const escrow = await dp2p.escrows(id);
      expect(escrow.agent, address0x);
      expect(escrow.seller, address0x);
      expect(escrow.buyer, address0x);
      expect(escrow.agentFee).to.eq.BN(0);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(prevBalEscrow)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(prevBalEscrow)
      );
    });
    it("platform cancel an escrow", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);

      const Cancel = await toEvents(dp2p.cancel(id, { from: owner }), "Cancel");

      expect(Cancel._id, id);
      expect(Cancel._amount).to.eq.BN(prevBalEscrow);

      const escrow = await dp2p.escrows(id);
      expect(escrow.agent, address0x);
      expect(escrow.seller, address0x);
      expect(escrow.buyer, address0x);
      expect(escrow.agentFee).to.eq.BN(0);
      expect(await dp2p.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(prevBalEscrow)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(dp2p.address)).to.eq.BN(
        prevBalTokenEscrow.sub(prevBalEscrow)
      );
    });
    it("cancel without being the agent", async () => {
      const id = await createBasicEscrow();
      await tryCatchRevert(
        () => dp2p.cancel(id, { from: seller }),
        "cancel: invalid-sender"
      );
    });
  });
  describe("cancelBySeller", () => {
    it("seller cancel an escrow using cancelBySeller", async () => {
      const amount = WEI;
      await mintAndApproveTokens(seller, amount);

      const internalSalt = Math.floor(Math.random() * 1000000);
      const limit = 3;

      const id = await calcId(
        agent,
        seller,
        address0x,
        500,
        erc20.address,
        limit,
        internalSalt
      );

      await dp2p.createAndDeposit(
        amount,
        agent,
        address0x,
        erc20.address,
        limit,
        internalSalt,
        {
          from: seller,
        }
      );
      const Cancel = await toEvents(
        dp2p.cancelBySeller(id, { from: seller }),
        "Cancel"
      );
      expect(Cancel._id, id);

      const escrow = await dp2p.escrows(id);
      expect(escrow.agent, address0x);
      expect(escrow.seller, address0x);
      expect(escrow.buyer, address0x);
    });
    it("revert, seller want to cancel an escrow but out time (limit != 0)", async () => {
      const amount = WEI;
      await mintAndApproveTokens(seller, amount);

      const internalSalt = Math.floor(Math.random() * 1000000);

      const limit = 1 

      const id = await calcId(
        agent,
        seller,
        address0x,
        500,
        erc20.address,
        limit,
        internalSalt
      );

      await dp2p.createAndDeposit(
        amount,
        agent,
        address0x,
        erc20.address,
        limit,
        internalSalt,
        {
          from: seller,
        }
      );

      await increase(duration.hours(2));

      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: seller }),
        "cancelBySeller: invalid-limit-time"
      );
    });
    it("revert, seller want to cancel an escrow but out time (limit > 0)", async () => {
      const amount = WEI;
      await mintAndApproveTokens(seller, amount);

      const internalSalt = Math.floor(Math.random() * 1000000);
      const limit = 0;

      const id = await calcId(
        agent,
        seller,
        address0x,
        500,
        erc20.address,
        limit,
        internalSalt
      );

      await dp2p.createAndDeposit(
        amount,
        agent,
        address0x,
        erc20.address,
        limit,
        internalSalt,
        {
          from: seller,
        }
      );

      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: seller }),
        "cancelBySeller: invalid-limit-time"
      );
    });
    it("revert, the seller want to cancel an escrow in complete state", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: seller }),
        "cancelBySeller: complete-escrow"
      );
    });
    it("agent, buyer or owner wanto to execute cancelBySeller", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: buyer }),
        "cancelBySeller: invalid-sender"
      );

      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: agent }),
        "cancelBySeller: invalid-sender"
      );

      await tryCatchRevert(
        () => dp2p.cancelBySeller(id, { from: owner }),
        "cancelBySeller: invalid-sender"
      );
    });
  });
  describe("newAgent", () => {
    it("new agent", async () => {
      await toEvents(
        dp2p.newAgent(accounts[9], 500, { from: owner }),
        "NewAgent"
      );
    });
    it("already exist", async () => {
      await tryCatchRevert(
        () => dp2p.newAgent(accounts[9], 500, { from: owner }),
        "newAgent: invalid agent"
      );
    });
    it("invalid address", async () => {
      await tryCatchRevert(
        () => dp2p.newAgent(address0x, 500, { from: owner }),
        "newAgent: invalid-address"
      );
    });
    it("set a higth agent fee(>10%)", async () => {
      await tryCatchRevert(
        () => dp2p.newAgent(accounts[9], 1001, { from: owner }),
        "newAgent: invalid-agent-fee"
      );
      await tryCatchRevert(
        () => dp2p.newAgent(accounts[9], maxUint(256), { from: owner }),
        "newAgent: invalid-agent-fee"
      );
    });
  });
  describe("RemoveAgent", () => {
    it("remove agent", async () => {
      await toEvents(
        dp2p.removeAgent(accounts[9], { from: owner }),
        "RemoveAgent"
      );
    });
    it("not exist", async () => {
      await tryCatchRevert(
        () => dp2p.removeAgent(accounts[9], { from: owner }),
        "removeAgent: invalid-agent"
      );
    });
    it("invalid address", async () => {
      await tryCatchRevert(
        () => dp2p.removeAgent(address0x, { from: owner }),
        "removeAgent: invalid-address"
      );
    });
  });
});
