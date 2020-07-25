// SPDX-License-Identifier: MIT
pragma solidity 0.6.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";

contract Stablescrow is Ownable {
    using SafeMath for uint256;

    /// User Events
    event CreateEscrow(
        bytes32 _id,
        address _agent,
        address _seller,
        address _buyer,
        uint256 _fee,
        address _token,
        uint256 _salt
    );

    event Deposit(bytes32 _id, uint256 _toEscrow, uint256 _toPlatform);

    event Release(
        bytes32 _id,
        address _sender,
        address _to,
        uint256 _toAmount,
        uint256 _toAgent
    );

    event DisputeResolved(
        bytes32 _id,
        address _sender,
        address _to,
        uint256 _toAmount,
        uint256 _toAgent
    );

    event BuyerCancel(bytes32 _id, uint256 _toAmount, uint256 _toAgent);

    event Cancel(bytes32 _id, uint256 _amount);

    /// Platform events

    event SetFee(uint256 _fee);

    event NewAgent(address _agent);

    event RemoveAgent(address _agent);

    event PlatformWithdraw(address[] _tokens, address _to, uint256 _amount);

    struct Escrow {
        address agent;
        address seller;
        address buyer;
        uint256 fee;
        uint256 balance;
        address token;
    }

    /// 10000 ==  100%
    ///   505 == 5.05%
    uint256 public constant BASE = 10000;
    uint256 public constant MAX_FEE = 50;
    uint256 public constant MAX_AGENT_FEE = 1000;

    uint256 public fee;
    mapping(address => uint256) public platformBalanceByToken;

    mapping(bytes32 => Escrow) public escrows;
    mapping(address => bool) public agents;

    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(
            _fee <= MAX_FEE,
            "setPlatformFee: The platform fee should be lower than the MAX_FEE"
        );
        fee = _fee;
        emit SetFee(_fee);
    }

    function platformWithdraw(
        address[] calldata _tokenAddresses,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        require(_to != address(0), "platformWithdraw: address 0x is invalid");
        for (uint256 i = 0; i < _tokenAddresses.length; i++) {
            address tokenAddress = _tokenAddresses[i];
            platformBalanceByToken[tokenAddress] = platformBalanceByToken[tokenAddress]
                .sub(_amount);
            require(
                IERC20(tokenAddress).transfer(_to, _amount),
                "platformWithdraw: Error transfer to platform"
            );
        }
        emit PlatformWithdraw(_tokenAddresses, _to, _amount);
    }

    function newAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "newAgent: address 0x is invalid");
        require(!agents[_agent], "newAgent: the agent alredy exists");
        agents[_agent] = true;
        emit NewAgent(_agent);
    }

    function removeAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "removeAgent: address 0x is invalid");
        require(agents[_agent], "removeAgent: the agent does not exist");
        agents[_agent] = false;
        emit RemoveAgent(_agent);
    }

    /// View functions

    function calculateId(
        address _agent,
        address _seller,
        address _buyer,
        uint256 _fee,
        address _token,
        uint256 _salt
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    _agent,
                    _seller,
                    _buyer,
                    _fee,
                    _token,
                    _salt
                )
            );
    }

    /// External functions

    /**
        @notice Create an ERC20 escrow
            Fee: The ratio is expressed in order of BASE
            Examples:
            - 1% is 100
            - 50.00% is 5000
            - 23.45% is 2345
            -----------------
            - The agent will be the sender of the transaction
            - The _fee should be lower than 1000(10%)

        @param _seller the seller address
        @param _buyer the buyer address
        @param _fee the fee percentage (calculate in BASE), this fee will sent to the agent when the escrow is withdraw
        @param _fee address token (DAI, USDC, WBTC, etc)
        @param _salt An entropy value, used to generate the id
        @return id of the escrow
    */
    function createEscrow(
        address _seller,
        address _buyer,
        uint256 _fee,
        address _token,
        uint256 _salt
    ) external returns (bytes32 id) {
        id = _createEscrow(msg.sender, _seller, _buyer, _fee, _token, _salt);
    }

    /**
        @notice deposit an amount in escrown after that create this
        @dev create and deposit operation in one transaction,
             the seller of the escrow should be the sender
    */
    function createAndDepositEscrow(
        uint256 _amount,
        address _agent,
        address _buyer,
        uint256 _fee,
        address _token,
        uint256 _salt
    ) external returns (bytes32 id) {
        id = _createEscrow(_agent, msg.sender, _buyer, _fee, _token, _salt);
        _deposit(id, _amount);
    }

    /**
        @notice deposit an amount to escrow
        @dev the seller of the escrow should be the sender
        @param _id the id of the escrow
        @param _amount the amount to deposit in an escrow, with platform fee amount
    */
    function deposit(bytes32 _id, uint256 _amount) external {
        _deposit(_id, _amount);
    }

    /**
        @notice relase an amount from an escrow and send the tokens to the buyer address
        @dev the sender should be the seller of the escrow
    */
    function release(bytes32 _id, uint256 _amount) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.seller,
            "release: the sender should be the seller"
        );
        (uint256 toAmount, uint256 agentFee) = _withdraw(
            _id,
            escrow.buyer,
            _amount
        );
        emit Release(_id, escrow.seller, escrow.buyer, toAmount, agentFee);
    }

    /**
        @notice resolve dispute
        @dev The sender should be the agent of the escrow
    */
    function resolveDispute(bytes32 _id, uint256 _amount) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.agent || msg.sender == _owner,
            "resolveDispute: the sender should be the agent or owner"
        );
        (uint256 toAmount, uint256 agentFee) = _withdrawWithFee(
            _id,
            escrow.buyer,
            _amount
        );
        emit DisputeResolved(
            _id,
            escrow.agent,
            escrow.buyer,
            toAmount,
            agentFee
        );
    }

    /**
        @notice Withdraw an amount from an escrow and the tokens send to the seller address
        @dev the sender should be the buyer or the agent of the escrow

        @param _id The id of the escrow
    */
    function buyerCancel(bytes32 _id) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.buyer || msg.sender == escrow.agent,
            "buyerCancel: the sender should be the buyer or the agent"
        );
        uint256 toAmount;
        uint256 agentFee;
        if (msg.sender == escrow.agent) {
            (toAmount, agentFee) = _withdrawWithFee(
                _id,
                escrow.seller,
                escrow.balance
            );
        } else {
            (toAmount, agentFee) = _withdraw(
                _id,
                escrow.seller,
                escrow.balance
            );
        }
        emit BuyerCancel(_id, toAmount, agentFee);
    }

    /**
        @notice cancel an escrow and send the escrow balance to the seller address
        @dev the sender should be the agent
        @dev the escrow will be deleted
        @param _id the id of the escrow
    */
    function cancel(bytes32 _id) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.agent || msg.sender == _owner,
            "cancel: the sender should be the agent"
        );

        uint256 balance = escrow.balance;
        address seller = escrow.seller;
        IERC20 token = IERC20(escrow.token);
        /// Delete escrow
        delete escrows[_id];

        /// Send the tokens to the seller if the escrow have balance
        if (balance > 0)
            require(
                token.transfer(seller, balance),
                "cancel: error transfer to the seller"
            );

        emit Cancel(_id, balance);
    }

    /// Internal functions

    function _deposit(bytes32 _id, uint256 _amount) internal {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.seller,
            "deposit: The sender should be the seller"
        );

        uint256 platformFee = _feeAmount(_amount, fee);

        /// Transfer the tokens
        IERC20 token = IERC20(escrow.token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "deposit: Error deposit tokens"
        );

        /// Assign the fee amount to platform
        address tokenAddress = escrow.token;
        platformBalanceByToken[tokenAddress] = platformBalanceByToken[tokenAddress]
            .add(platformFee);

        /// Assign the deposit amount to the escrow, subtracting the fee platform amount
        uint256 toEscrow = _amount.sub(platformFee);
        escrow.balance = escrow.balance.add(toEscrow);

        emit Deposit(_id, toEscrow, platformFee);
    }

    function _createEscrow(
        address _agent,
        address _seller,
        address _buyer,
        uint256 _fee,
        address _token,
        uint256 _salt
    ) internal returns (bytes32 id) {
        require(_token != address(0), "_createEscrow: address 0x is invalid");

        require(
            _fee <= MAX_AGENT_FEE,
            "createEscrow: The agent fee should be lower or the same than 1000"
        );

        require(agents[_agent], "createEscrow: the agent is invalid");

        /// Calculate the escrow id
        id = calculateId(_agent, _seller, _buyer, _fee, _token, _salt);

        /// Check if the escrow was created
        require(
            escrows[id].agent == address(0),
            "createEscrow: The escrow exists"
        );

        /// Add escrow to the escrows array
        escrows[id] = Escrow({
            agent: _agent,
            seller: _seller,
            buyer: _buyer,
            fee: _fee,
            token: _token,
            balance: 0
        });

        emit CreateEscrow(id, _agent, _seller, _buyer, _fee, _token, _salt);
    }

    /**
        @notice Withdraw an amount from an escrow without fee and send to _to address
        @dev The sender should be the _approved or the agent of the escrow
        @param _id the id of the escrow
        @param _to the address where the tokens will go
        @param _amount the base amount
    */
    function _withdraw(
        bytes32 _id,
        address _to,
        uint256 _amount
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        return _withdraw(_id, _to, _amount, false);
    }

    /**
        @notice Withdraw an amount from an escrow with fee and send to _to address
        @dev The sender should be the _approved or the agent of the escrow
        @param _id the id of the escrow
        @param _to the address where the tokens will go
        @param _amount the base amount
    */
    function _withdrawWithFee(
        bytes32 _id,
        address _to,
        uint256 _amount
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        return _withdraw(_id, _to, _amount, true);
    }

    /**
        @notice Withdraw an amount from an escrow and send to _to address
        @dev The sender should be the _approved or the agent of the escrow
        @param _id the id of the escrow
        @param _to the address where the tokens will go
        @param _amount the base amount
        @param _withFee to know if this operation has fee
    */
    function _withdraw(
        bytes32 _id,
        address _to,
        uint256 _amount,
        bool _withFee
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        Escrow storage escrow = escrows[_id];
        IERC20 token = IERC20(escrow.token);

        if (msg.sender == _owner) {
            toAmount = _amount;
        } else {
            /// calculate the fee
            agentFee = 0;
            if (_withFee) {
                agentFee = _feeAmount(_amount, escrow.fee);
            }
            /// update escrow balance in storage
            escrow.balance = escrow.balance.sub(_amount);
            /// send fee to the agent
            require(
                token.transfer(escrow.agent, agentFee),
                "_withdraw: Error transfer tokens to the agent"
            );
            /// substract the agent fee
            toAmount = _amount.sub(agentFee);
        }
        /// send amount to the _to
        require(
            token.transfer(_to, toAmount),
            "_withdraw: Error transfer to the _to"
        );
    }

    /**
        @notice fee amount calculation
        @dev Formula: _amount * _fee / BASE
        @param _amount The base amount
        @param _fee The fee
        @return calculated fee
    */
    function _feeAmount(uint256 _amount, uint256 _fee)
        internal
        pure
        returns (uint256)
    {
        return _amount.mul(_fee).div(BASE);
    }
}
