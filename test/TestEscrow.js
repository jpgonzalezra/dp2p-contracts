const TestToken = artifacts.require("TestToken");
const Stablescrow = artifacts.require("Stablescrow");

const {
  bn,
  expect,
  toEvents,
  tryCatchRevert,
  address0x,
  maxUint,
  random32,
  fixSignature,
} = require("./helper/index.js");

contract("Stablescrow", (accounts) => {
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

  let tokenEscrow;
  let erc20;

  let salt = 0;
  let basicEscrow;

  const approve = async (beneficiary, amount) => {
    await erc20.mint(beneficiary, amount, { from: owner });
    await erc20.approve(tokenEscrow.address, amount, { from: beneficiary });
  };

  const updateBalances = async (id) => {
    prevBalOwner = await erc20.balanceOf(owner);
    prevBalCreator = await erc20.balanceOf(creator);
    prevBalAgent = await erc20.balanceOf(agent);
    prevBalanceSeller = await erc20.balanceOf(seller);
    prevBalanceBuyer = await erc20.balanceOf(buyer);

    const escrow = await tokenEscrow.escrows(id);
    prevBalEscrow = escrow.balance;
    prevBalTokenEscrow = await erc20.balanceOf(tokenEscrow.address);
    prevPlatformBalance = await tokenEscrow.platformBalanceByToken(
      erc20.address
    );
  };

  const calcId = (_agent, _seller, _buyer, _fee, _token, _salt) =>
    web3.utils.soliditySha3(
      { t: "address", v: tokenEscrow.address },
      { t: "address", v: _agent },
      { t: "address", v: _seller },
      { t: "address", v: _buyer },
      { t: "uint256", v: _fee },
      { t: "address", v: _token },
      { t: "uint256", v: _salt }
    );

  const createBasicEscrow = async (amount = WEI) => {
    basicEscrow.salt = ++salt;
    await approve(seller, amount);
    const CreateAndDeposit = await toEvents(
      tokenEscrow.createAndDeposit(
        amount,
        basicEscrow.agent,
        basicEscrow.buyer,
        basicEscrow.token,
        basicEscrow.salt,
        {
          from: seller,
        }
      ),
      "CreateAndDeposit"
    );
    const fee = await tokenEscrow.agentFeeByAgentAddress(basicEscrow.agent);
    const id = await calcId(
      basicEscrow.agent,
      basicEscrow.seller,
      basicEscrow.buyer,
      fee,
      basicEscrow.token,
      basicEscrow.salt
    );
    expect(CreateAndDeposit._id, id);
    return id;
  };

  before("deploy contracts", async function () {
    erc20 = await TestToken.new({ from: owner });
    tokenEscrow = await Stablescrow.new({ from: owner });
    await tokenEscrow.newAgent(agent, 500, { from: owner });

    await tokenEscrow.setPlatformFee(50, { from: owner });

    basicEscrow = {
      agent,
      seller,
      buyer,
      token: erc20.address,
      salt,
    };
  });

  describe("setPlataforFee", function () {
    it("set 0% platform fee", async () => {
      const fee = bn(0);
      const setFeeEvent = await toEvents(
        tokenEscrow.setPlatformFee(fee, { from: owner }),
        "SetFee"
      );

      expect(setFeeEvent._fee).to.eq.BN(fee);
      expect(await tokenEscrow.platformFee()).to.eq.BN(fee);
    });
    it("set max platform fee allowed", async () => {
      const maxFeeAllowed = MAX_PLATFORM_FEE;
      const setFeeEvent = await toEvents(
        tokenEscrow.setPlatformFee(maxFeeAllowed, { from: owner }),
        "SetFee"
      );

      expect(setFeeEvent._fee).to.eq.BN(maxFeeAllowed);
      expect(await tokenEscrow.platformFee()).to.eq.BN(maxFeeAllowed);
    });
    it("should be fail, set fee > MAX_PLATFORM_FEE", async function () {
      const maxFeeAllowed = MAX_PLATFORM_FEE;
      const wrongFee = maxFeeAllowed + 1;
      await tryCatchRevert(
        () => tokenEscrow.setPlatformFee(wrongFee, { from: owner }),
        "setPlatformFee: The platform fee should be lower than the MAX_PLATFORM_FEE"
      );
      await tryCatchRevert(
        () => tokenEscrow.setPlatformFee(maxUint(256), { from: owner }),
        "setPlatformFee: The platform fee should be lower than the MAX_PLATFORM_FEE"
      );
    });
  });
  describe("onlyOwner", async function () {
    it("not owner want to set platform fee", async function () {
      await tryCatchRevert(
        () => tokenEscrow.setPlatformFee(0, { from: creator }),
        "Owneable: The owner should be the sender"
      );
    });
    it("not owner want to withdraw tokens", async function () {
      await tryCatchRevert(
        () =>
          tokenEscrow.platformWithdraw([erc20.address], address0x, address0x, {
            from: creator,
          }),
        "Owneable: The owner should be the sender"
      );
    });
  });
  describe("platformWithdraw", function () {
    it("platform balance withdraw", async () => {
      const id = await createBasicEscrow();
      const fee = await tokenEscrow.platformFee();
      const platatormFee = WEI.mul(fee).div(BASE);
      await updateBalances(id);

      const platformWithdraw = await toEvents(
        tokenEscrow.platformWithdraw([erc20.address], creator, platatormFee, {
          from: owner,
        }),
        "PlatformWithdraw"
      );

      expect(platformWithdraw._to, creator);
      expect(platformWithdraw._token, erc20.address);
      expect(platformWithdraw._amount).to.eq.BN(platatormFee);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.sub(platatormFee)
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(
        prevBalCreator.add(platatormFee)
      );
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(platatormFee)
      );
    });
    it("want to withdraw with invalid amount", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);

      await tryCatchRevert(
        () =>
          tokenEscrow.platformWithdraw([erc20.address], creator, maxUint(256), {
            from: owner,
          }),
        "Sub overflow"
      );
    });
    it("want to withdraw to invalid address", async function () {
      await tryCatchRevert(
        () =>
          tokenEscrow.platformWithdraw([erc20.address], address0x, 0, {
            from: owner,
          }),
        "platformWithdraw: address 0x is invalid"
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
          tokenEscrow.releaseWithSellerSignature(id, sellerSignature, {
            from: seller,
          }),
        "releaseWithSellerSignature: invalid sender or invalid seller signature"
      );
    });
    it("withdraw to seller non-escrow", async () => {
      await tryCatchRevert(
        () => tokenEscrow.buyerCancel(random32(), { from: agent }),
        "buyerCancel: the sender should be the buyer"
      );
    });
    it("cancel an escrow non-existent", async () => {
      await tryCatchRevert(
        () => tokenEscrow.cancel(random32(), { from: agent }),
        "cancel: the sender should be the agent"
      );
    });
  });
  describe("createAndDeposit", () => {
    it("create escrow and deposit", async () => {
      const amount = WEI;
      const internalSalt = 999;
      await approve(seller, amount);
      const id = await calcId(
        agent2,
        seller,
        buyer,
        500,
        erc20.address,
        internalSalt
      );
      await updateBalances(id);
      await tokenEscrow.newAgent(agent2, 500, { from: owner });

      const CreateAndDeposit = await toEvents(
        tokenEscrow.createAndDeposit(
          amount,
          agent2,
          buyer,
          erc20.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "CreateAndDeposit"
      );

      expect(CreateAndDeposit._id, id);
      const fee = await tokenEscrow.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(CreateAndDeposit._balance.add(CreateAndDeposit._platformAmount)).to.eq.BN(amount);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.balance, toEscrow);
      expect(escrow.agent, agent2);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
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
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("create two escrows with the same id", async () => {
      const amount = WEI;
      await tryCatchRevert(
        () =>
          tokenEscrow.createAndDeposit(
            amount,
            agent2,
            buyer,
            erc20.address,
            999,
            {
              from: seller,
            }
          ),
        "createAndDeposit: the escrow exists"
      );
    });
    it("create escrow and deposit tokens", async () => {
      const amount = WEI;

      await approve(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        tokenEscrow.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "CreateAndDeposit"
      );

      expect(CreateAndDeposit._id, id);
      const fee = await tokenEscrow.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);

      const escrow = await tokenEscrow.escrows(id);

      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
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
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("deposit 0 amount in an escrow", async () => {
      const amount = bn(0);

      await approve(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        tokenEscrow.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "CreateAndDeposit"
      );

      expect(CreateAndDeposit._id, id);
      const fee = await tokenEscrow.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(CreateAndDeposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow
      );
    });
    it("deposit higth amount in an escrow", async () => {
      const amount = maxUint(240);

      await approve(seller, amount);
      const internalSalt = Math.floor(Math.random() * 1000000);
      const id = await calcId(
        agent,
        seller,
        buyer,
        500,
        erc20.address,
        internalSalt
      );
      await updateBalances(id);

      const CreateAndDeposit = await toEvents(
        tokenEscrow.createAndDeposit(
          amount,
          agent,
          buyer,
          erc20.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "CreateAndDeposit"
      );
      expect(CreateAndDeposit._id, id);
      const fee = await tokenEscrow.platformFee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.balance).to.eq.BN(toEscrow);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.agentFee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
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
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
  });
  describe("releaseWithSellerSignature", () => {
    it("release escrow from seller", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const sellerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.seller)
      );
      const ReleaseWithSellerSignature = await toEvents(
        tokenEscrow.releaseWithSellerSignature(id, sellerSignature, {
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

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterRelease = await tokenEscrow.escrows(id);
      expect(escrowAfterRelease.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
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
          tokenEscrow.releaseWithSellerSignature(id, sellerSignature, {
            from: buyer,
          }),
        "releaseWithSellerSignature: invalid sender or invalid seller signature"
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
          tokenEscrow.releaseWithSellerSignature(id, buyerSignature, {
            from: buyer,
          }),
        "releaseWithSellerSignature: invalid sender or invalid seller signature"
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
          tokenEscrow.releaseWithSellerSignature(id, sellerSignature, {
            from: agent,
          }),
        "releaseWithSellerSignature: invalid sender or invalid seller signature"
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.releaseWithSellerSignature(id, sellerSignature, {
            from: seller,
          }),
        "releaseWithSellerSignature: invalid sender or invalid seller signature"
      );
    });
  });
  describe("releaseWithAgentSignature", () => {
    it("release escrow from buyer with agent signature", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const ReleaseWithAgentSignature = await toEvents(
        tokenEscrow.releaseWithAgentSignature(id, agentSignature, {
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

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterRelease = await tokenEscrow.escrows(id);
      expect(escrowAfterRelease.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
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
          tokenEscrow.releaseWithAgentSignature(id, agentSignature, {
            from: buyer,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
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
          tokenEscrow.releaseWithAgentSignature(id, buyerSignature, {
            from: buyer,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
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
          tokenEscrow.releaseWithAgentSignature(id, agentSignature, {
            from: agent,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.releaseWithAgentSignature(id, agentSignature, {
            from: seller,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
      );
    });
  });
  describe("resolveDisputeBuyer", () => {
    it("resolveDisputeBuyer from agent", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDisputeBuyer(id, agentSignature, { from: buyer }),
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
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(toAmount)
      );

      const escrowAfterDispute = await tokenEscrow.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("resolveDisputeBuyer from owner", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;

      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDisputeBuyer(id, "0x", { from: owner }),
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
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalanceBuyer.add(amount)
      );

      const escrowAfterDispute = await tokenEscrow.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
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
          tokenEscrow.resolveDisputeBuyer(id, agentSignature, {
            from: agent,
          }),
        "resolveDispute: invalid sender or invalid agent signature"
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.resolveDisputeBuyer(id, agentSignature, {
            from: seller,
          }),
        "resolveDispute: invalid sender or invalid agent signature"
      );
    });
  });
  describe("resolveDisputeSeller", () => {
    it("resolveDisputeSeller from agent", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;
      const toAgent = amount.mul(escrow.agentFee).div(BASE);
      const toAmount = amount.sub(toAgent);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDisputeSeller(id, agentSignature, { from: seller }),
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
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(toAmount)
      );

      const escrowAfterDispute = await tokenEscrow.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("resolveDisputeSeller from owner", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);
      const escrow = await tokenEscrow.escrows(id);
      const amount = escrow.balance;

      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDisputeSeller(id, "0x", { from: owner }),
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
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(amount)
      );

      const escrowAfterDispute = await tokenEscrow.escrows(id);
      expect(escrowAfterDispute.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
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
          tokenEscrow.resolveDisputeSeller(id, agentSignature, {
            from: agent,
          }),
        "resolveDispute: invalid sender or invalid agent signature"
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.resolveDisputeSeller(id, agentSignature, {
            from: buyer,
          }),
        "resolveDispute: invalid sender or invalid agent signature"
      );
    });
  });
  describe("buyerCancel", () => {
    it("buyerCancel by the buyer", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);

      const prevSellerBalance = await erc20.balanceOf(seller);
      const BuyerCancel = await toEvents(
        tokenEscrow.buyerCancel(id, { from: buyer }),
        "BuyerCancel"
      );
      const currentSellerBalance = await erc20.balanceOf(seller);
      const amount = currentSellerBalance.sub(prevSellerBalance);
      const escrow = await tokenEscrow.escrows(id);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(BuyerCancel._id, id);
      expect(BuyerCancel._sender, buyer);
      expect(BuyerCancel._to, seller);
      expect(BuyerCancel._toAmount).to.eq.BN(amount);
      expect(BuyerCancel._toAgent).to.eq.BN(0);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalanceBuyer);
      expect(escrow.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("buyerCancel without being the buyer", async () => {
      const id = await createBasicEscrow();

      await tryCatchRevert(
        () => tokenEscrow.buyerCancel(id, { from: seller }),
        "buyerCancel: the sender should be the buyer"
      );

      await tryCatchRevert(
        () => tokenEscrow.buyerCancel(id, { from: creator }),
        "buyerCancel: the sender should be the buyer"
      );
    });
  });
  describe("cancel", () => {
    it("agent cancel an escrow", async () => {
      const id = await createBasicEscrow();

      await updateBalances(id);

      const Cancel = await toEvents(
        tokenEscrow.cancel(id, { from: agent }),
        "Cancel"
      );

      expect(Cancel._id, id);
      expect(Cancel._amount).to.eq.BN(prevBalEscrow);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, address0x);
      expect(escrow.seller, address0x);
      expect(escrow.buyer, address0x);
      expect(escrow.agentFee).to.eq.BN(0);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
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
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(prevBalEscrow)
      );
    });
    it("platform cancel an escrow", async () => {
      const id = await createBasicEscrow();
      await updateBalances(id);

      const Cancel = await toEvents(
        tokenEscrow.cancel(id, { from: owner }),
        "Cancel"
      );

      expect(Cancel._id, id);
      expect(Cancel._amount).to.eq.BN(prevBalEscrow);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, address0x);
      expect(escrow.seller, address0x);
      expect(escrow.buyer, address0x);
      expect(escrow.agentFee).to.eq.BN(0);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
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
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(prevBalEscrow)
      );
    });
    it("cancel without being the agent", async () => {
      const id = await createBasicEscrow();

      await tryCatchRevert(
        () => tokenEscrow.cancel(id, { from: seller }),
        "cancel: the sender should be the agent"
      );
    });
  });
  describe("newAgent", () => {
    it("new agent", async () => {
      await toEvents(
        tokenEscrow.newAgent(accounts[9], 500, { from: owner }),
        "NewAgent"
      );
    });
    it("already exist", async () => {
      await tryCatchRevert(
        () => tokenEscrow.newAgent(accounts[9], 500, { from: owner }),
        "newAgent: the agent alredy exists"
      );
    });
    it("invalid address", async () => {
      await tryCatchRevert(
        () => tokenEscrow.newAgent(address0x, 500, { from: owner }),
        "newAgent: address 0x is invalid"
      );
    });
    it("set a higth agent fee(>10%)", async () => {
      await tryCatchRevert(
        () => tokenEscrow.newAgent(accounts[9], 1001, { from: owner }),
        "newAgent: The agent fee should be lower or equal than 1000"
      );
      await tryCatchRevert(
        () => tokenEscrow.newAgent(accounts[9], maxUint(256), { from: owner }),
        "newAgent: The agent fee should be lower or equal than 1000"
      );
    });
  });
  describe("RemoveAgent", () => {
    it("remove agent", async () => {
      await toEvents(
        tokenEscrow.removeAgent(accounts[9], { from: owner }),
        "RemoveAgent"
      );
    });
    it("not exist", async () => {
      await tryCatchRevert(
        () => tokenEscrow.removeAgent(accounts[9], { from: owner }),
        "removeAgent: the agent does not exist"
      );
    });
    it("invalid address", async () => {
      await tryCatchRevert(
        () => tokenEscrow.removeAgent(address0x, { from: owner }),
        "removeAgent: address 0x is invalid"
      );
    });
  });
});
