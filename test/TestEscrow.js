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
  random32bn,
  fixSignature,
} = require("./helper/index.js");

contract("Stablescrow", (accounts) => {
  const WEI = bn(web3.utils.toWei("1"));
  let BASE;

  const owner = accounts[1];
  const creator = accounts[2];
  const agent = accounts[5];
  const agent2 = accounts[6];
  const seller = accounts[3];
  const buyer = accounts[4];

  let prevBalOwner = 0;
  let prevBalCreator = 0;
  let prevBalanceSeller = 0;
  let prevBalalanceBuyer = 0;
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
    prevBalalanceBuyer = await erc20.balanceOf(buyer);

    const escrow = await tokenEscrow.escrows(id);
    prevBalEscrow = escrow.balance;
    prevBalTokenEscrow = await erc20.balanceOf(tokenEscrow.address);
    prevPlatformBalance = await tokenEscrow.platformBalanceByToken(
      erc20.address
    );
  };

  const calcId = async (_agent, _seller, _buyer, _fee, _token, _salt) =>
    web3.utils.soliditySha3(
      { t: "address", v: tokenEscrow.address },
      { t: "address", v: _agent },
      { t: "address", v: _seller },
      { t: "address", v: _buyer },
      { t: "uint32", v: _fee },
      { t: "address", v: _token },
      { t: "uint256", v: _salt }
    );

  const createBasicEscrow = async () => {
    basicEscrow.salt = ++salt;

    await tokenEscrow.createEscrow(
      basicEscrow.seller,
      basicEscrow.buyer,
      basicEscrow.token,
      basicEscrow.salt,
      { from: basicEscrow.agent }
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
    return id;
  };

  const deposit = async (id, amount = WEI) => {
    const escrow = await tokenEscrow.escrows(id);
    await approve(escrow.seller, amount);
    await tokenEscrow.deposit(id, amount, { from: escrow.seller });
  };

  before("deploy contracts", async function () {
    erc20 = await TestToken.new({ from: owner });
    tokenEscrow = await Stablescrow.new({ from: owner });
    await tokenEscrow.newAgent(agent, 500, { from: owner });

    await tokenEscrow.setPlatformFee(50, { from: owner });
    BASE = await tokenEscrow.BASE();

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
      expect(await tokenEscrow.fee()).to.eq.BN(fee);
    });
    it("set max platform fee allowed", async () => {
      const maxFeeAllowed = await tokenEscrow.MAX_FEE();
      const setFeeEvent = await toEvents(
        tokenEscrow.setPlatformFee(maxFeeAllowed, { from: owner }),
        "SetFee"
      );

      expect(setFeeEvent._fee).to.eq.BN(maxFeeAllowed);
      expect(await tokenEscrow.fee()).to.eq.BN(maxFeeAllowed);
    });
    it("should be fail, set fee > MAX_FEE", async function () {
      const maxFeeAllowed = await tokenEscrow.MAX_FEE();
      const wrongFee = maxFeeAllowed + 1;
      await tryCatchRevert(
        () => tokenEscrow.setPlatformFee(wrongFee, { from: owner }),
        "setPlatformFee: The platform fee should be lower than the MAX_FEE"
      );
      await tryCatchRevert(
        () => tokenEscrow.setPlatformFee(maxUint(256), { from: owner }),
        "setPlatformFee: The platform fee should be lower than the MAX_FEE"
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
      await deposit(id);

      const fee = await tokenEscrow.fee();
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
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(platatormFee)
      );
    });
    it("want to withdraw with invalid amount", async () => {
      const id = await createBasicEscrow();

      await deposit(id);
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
    it("deposit when does not exist the escrow", async () => {
      await tryCatchRevert(
        () => tokenEscrow.deposit(random32(), 0, { from: agent }),
        "deposit: The sender should be the seller"
      );
    });
    it("withdraw to buyer non-escrow", async () => {
      await tryCatchRevert(
        () => tokenEscrow.release(random32(), 0, { from: agent }),
        "release: the sender should be the seller"
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
  describe("createEscrow", function () {
    it("create basic escrow", async () => {
      const internalSalt = random32bn();
      const agentFee = 500;
      const id = await calcId(
        agent,
        seller,
        buyer,
        agentFee,
        erc20.address,
        internalSalt
      );

      const CreateEscrow = await toEvents(
        tokenEscrow.createEscrow(seller, buyer, erc20.address, internalSalt, {
          from: agent,
        }),
        "CreateEscrow"
      );

      expect(CreateEscrow._id).to.equal(id);
      expect(CreateEscrow._agent).to.equal(agent);
      expect(CreateEscrow._seller).to.equal(seller);
      expect(CreateEscrow._buyer).to.equal(buyer);
      expect(CreateEscrow._fee).to.eq.BN(agentFee);
      expect(CreateEscrow._token).to.equal(erc20.address);
      expect(CreateEscrow._salt).to.eq.BN(internalSalt);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(agentFee);
      expect(escrow.balance).to.eq.BN(0);
    });
    it("create two escrows with the same id", async function () {
      await tryCatchRevert(
        () =>
          tokenEscrow.createEscrow(
            basicEscrow.seller,
            basicEscrow.buyer,
            basicEscrow.token,
            basicEscrow.salt,
            { from: basicEscrow.agent }
          ),
        "createEscrow: The escrow exists"
      );
    });
  });
  describe("createAndDepositEscrow", function () {
    it("create escrow and deposit in the same operation", async () => {
      const amount = WEI;

      await approve(seller, amount);
      const internalSalt = basicEscrow.salt;
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

      const Deposit = await toEvents(
        tokenEscrow.createAndDepositEscrow(
          amount,
          agent2,
          buyer,
          erc20.address,
          internalSalt,
          {
            from: seller,
          }
        ),
        "Deposit"
      );

      expect(Deposit._id, id);
      const fee = await tokenEscrow.fee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(Deposit._toEscrow).to.eq.BN(toEscrow);
      expect(Deposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, agent2);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent2)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);
      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
  });
  describe("deposit", function () {
    it("deposit tokens in an escrow", async () => {
      const id = await createBasicEscrow();
      const amount = WEI;

      await approve(seller, amount);
      await updateBalances(id);

      const Deposit = await toEvents(
        tokenEscrow.deposit(id, amount, { from: seller }),
        "Deposit"
      );

      expect(Deposit._id, id);
      const fee = await tokenEscrow.fee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(Deposit._toEscrow).to.eq.BN(toEscrow);
      expect(Deposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("deposit 0 amount in an escrow", async () => {
      const id = await createBasicEscrow();
      const amount = bn(0);

      await approve(seller, amount);
      await updateBalances(id);

      const Deposit = await toEvents(
        tokenEscrow.deposit(id, amount, { from: seller }),
        "Deposit"
      );

      expect(Deposit._id, id);
      const fee = await tokenEscrow.fee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(Deposit._toEscrow).to.eq.BN(toEscrow);
      expect(Deposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow
      );
    });
    it("deposit higth amount in an escrow", async () => {
      const id = await createBasicEscrow();
      const amount = maxUint(240);

      await approve(seller, amount);
      await updateBalances(id);

      const Deposit = await toEvents(
        tokenEscrow.deposit(id, amount, { from: seller }),
        "Deposit"
      );

      expect(Deposit._id, id);
      const fee = await tokenEscrow.fee();
      const toPlatform = amount.mul(fee).div(BASE);
      const toEscrow = amount.sub(toPlatform);
      expect(Deposit._toEscrow).to.eq.BN(toEscrow);
      expect(Deposit._toPlatform).to.eq.BN(toPlatform);

      const escrow = await tokenEscrow.escrows(id);
      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance.add(toPlatform)
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.sub(amount)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);

      expect(escrow.balance).to.eq.BN(prevBalEscrow.add(toEscrow));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.add(amount)
      );
    });
    it("deposit in an escrow without be the seller", async () => {
      const id = await createBasicEscrow();

      await tryCatchRevert(
        () => tokenEscrow.deposit(id, 0, { from: creator }),
        "deposit: The sender should be the seller"
      );
    });
  });
  describe("release", function () {
    it("release escrow from seller", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));

      await updateBalances(id);

      const Release = await toEvents(
        tokenEscrow.release(id, amount, { from: seller }),
        "Release"
      );

      expect(Release._id, id);
      expect(Release._sender, seller);
      expect(Release._to, buyer);
      const escrow = await tokenEscrow.escrows(id);
      const toAgent = amount.mul(escrow.fee).div(BASE);
      const toAmount = amount.sub(toAgent);
      expect(Release._toAmount).to.eq.BN(toAmount);
      expect(Release._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalalanceBuyer.add(toAmount)
      );

      expect(escrow.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("release invalid amount (0)", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = bn(0);

      await updateBalances(id);

      const Release = await toEvents(
        tokenEscrow.release(id, amount, { from: seller }),
        "Release"
      );

      expect(Release._id, id);
      expect(Release._sender, seller);
      expect(Release._to, buyer);
      const escrow = await tokenEscrow.escrows(id);
      const toAgent = amount.mul(escrow.fee).div(BASE);
      const toAmount = amount.sub(toAgent);
      expect(Release._toAmount).to.eq.BN(toAmount);
      expect(Release._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalalanceBuyer.add(toAmount)
      );

      expect(escrow.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("release with invalid address, should be the seller", async () => {
      const id = await createBasicEscrow();

      await tryCatchRevert(
        () => tokenEscrow.release(id, 0, { from: buyer }),
        "release: the sender should be the seller"
      );

      await tryCatchRevert(
        () => tokenEscrow.release(id, 0, { from: creator }),
        "release: the sender should be the seller"
      );
    });
  });
  describe("releaseWithAgentSignature", function () {
    it("release escrow from buyer with agent signature", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));
      await updateBalances(id);

      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      const ReleaseWithAgentSignature = await toEvents(
        tokenEscrow.releaseWithAgentSignature(id, amount, agentSignature, {
          from: buyer,
        }),
        "ReleaseWithAgentSignature"
      );

      expect(ReleaseWithAgentSignature._id, id);
      expect(ReleaseWithAgentSignature._sender, seller);
      expect(ReleaseWithAgentSignature._to, buyer);
      const escrow = await tokenEscrow.escrows(id);
      const toAgent = amount.mul(escrow.fee).div(BASE);
      const toAmount = amount.sub(toAgent);
      expect(ReleaseWithAgentSignature._toAmount).to.eq.BN(toAmount);
      expect(ReleaseWithAgentSignature._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalalanceBuyer.add(toAmount)
      );

      expect(escrow.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("revert release escrow, signature invalid (buyer sign)", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));
      await updateBalances(id);
  
      const buyerSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.buyer)
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.releaseWithAgentSignature(id, amount, buyerSignature, {
            from: buyer,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
      );
    });
    it("revert release escrow, the signature was correct but the sender was not buyer", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));
      await updateBalances(id);
  
      const agentSignature = fixSignature(
        await web3.eth.sign(id, basicEscrow.agent)
      );
      await tryCatchRevert(
        () =>
          tokenEscrow.releaseWithAgentSignature(id, amount, agentSignature, {
            from: agent,
          }),
        "releaseWithAgentSignature: invalid sender or invalid agent signature"
      );
    });
  });
  describe("resolveDispute", function () {
    it("resolveDispute from agent", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));

      await updateBalances(id);

      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDispute(id, amount, { from: agent }),
        "DisputeResolved"
      );
      const escrow = await tokenEscrow.escrows(id);

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      const toAgent = amount.mul(escrow.fee).div(BASE);
      const toAmount = amount.sub(toAgent);
      expect(DisputeResolved._toAmount).to.eq.BN(toAmount);
      expect(DisputeResolved._toAgent).to.eq.BN(toAgent);

      expect(escrow.agent, agent);
      expect(escrow.seller, seller);
      expect(escrow.buyer, buyer);
      expect(escrow.fee).to.eq.BN(500);

      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );

      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent.add(toAgent));
      expect(await erc20.balanceOf(seller)).to.eq.BN(prevBalanceSeller);
      expect(await erc20.balanceOf(buyer)).to.eq.BN(
        prevBalalanceBuyer.add(toAmount)
      );

      expect(escrow.balance).to.eq.BN(prevBalEscrow.sub(amount));
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(amount)
      );
    });
    it("resolveDispute from owner", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
      const amount = WEI.div(bn(2));

      await updateBalances(id);

      const DisputeResolved = await toEvents(
        tokenEscrow.resolveDispute(id, amount, { from: owner }),
        "DisputeResolved"
      );

      expect(DisputeResolved._id, id);
      expect(DisputeResolved._sender, agent);
      expect(DisputeResolved._to, buyer);
      const escrow = await tokenEscrow.escrows(id);
      amount.mul(escrow.fee).div(BASE);

      expect(DisputeResolved._toAmount).to.eq.BN(amount);
      expect(DisputeResolved._toAgent).to.eq.BN(0);
    });
    it("resolveDispute with invalid address, should be the agent", async () => {
      const id = await createBasicEscrow();

      await tryCatchRevert(
        () => tokenEscrow.resolveDispute(id, 0, { from: buyer }),
        "resolveDispute: the sender should be the agent or owner"
      );

      await tryCatchRevert(
        () => tokenEscrow.resolveDispute(id, 0, { from: creator }),
        "resolveDispute: the sender should be the agent or owner"
      );
    });
  });
  describe.only("buyerCancel", function () {
    it("buyerCancel by the buyer", async () => {
      const id = await createBasicEscrow();
      await deposit(id);
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
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);
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
  describe("cancel", function () {
    it("agent cancel an escrow", async () => {
      const id = await createBasicEscrow();
      
      await deposit(id);
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
      expect(escrow.fee).to.eq.BN(0);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(prevBalEscrow)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);

      expect(escrow.balance).to.eq.BN(0);
      expect(await erc20.balanceOf(tokenEscrow.address)).to.eq.BN(
        prevBalTokenEscrow.sub(prevBalEscrow)
      );
    });
    it("plataform cancel an escrow", async () => {
      const id = await createBasicEscrow();
      await deposit(id);

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
      expect(escrow.fee).to.eq.BN(0);
      expect(await tokenEscrow.platformBalanceByToken(erc20.address)).to.eq.BN(
        prevPlatformBalance
      );
      expect(await erc20.balanceOf(owner)).to.eq.BN(prevBalOwner);
      expect(await erc20.balanceOf(creator)).to.eq.BN(prevBalCreator);
      expect(await erc20.balanceOf(agent)).to.eq.BN(prevBalAgent);
      expect(await erc20.balanceOf(seller)).to.eq.BN(
        prevBalanceSeller.add(prevBalEscrow)
      );
      expect(await erc20.balanceOf(buyer)).to.eq.BN(prevBalalanceBuyer);

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
  describe("newAgent", function () {
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
    it("set a higth agent fee(>10%)", async function () {
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
  describe("RemoveAgent", function () {
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
