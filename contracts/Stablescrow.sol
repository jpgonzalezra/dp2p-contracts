// SPDX-License-Identifier: MIT
pragma solidity 0.6.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
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
        uint256 _plataformFee,
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

    event ReleaseWithAgentSignature(
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

    event NewAgent(address _agent, uint256 _fee);

    event RemoveAgent(address _agent);

    event PlatformWithdraw(address[] _tokens, address _to, uint256 _amount);

    struct Escrow {
        address agent;
        address seller;
        address buyer;
        uint32 fee;
        uint32 plataformFee;
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
    mapping(address => uint256) public agentFeeByAgentAddress;

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

    function newAgent(address _agentAddress, uint256 _fee) external onlyOwner {
        require(_agentAddress != address(0), "newAgent: address 0x is invalid");
        require(_fee > 0, "newAgent: the agent fee must be greater than 0");
        require(
            _fee <= MAX_AGENT_FEE,
            "newAgent: The agent fee should be lower or equal than 1000"
        );
        require(!agents[_agentAddress], "newAgent: the agent alredy exists");
        agents[_agentAddress] = true;
        agentFeeByAgentAddress[_agentAddress] = _fee;
        emit NewAgent(_agentAddress, fee);
    }

    function removeAgent(address _agentAddress) external onlyOwner {
        require(
            _agentAddress != address(0),
            "removeAgent: address 0x is invalid"
        );
        require(agents[_agentAddress], "removeAgent: the agent does not exist");
        agents[_agentAddress] = false;
        delete agentFeeByAgentAddress[_agentAddress];
        emit RemoveAgent(_agentAddress);
    }

    // function bulkUpdateAgents(address[] agents, uint256[] fees) external onlyOwner {
    //      TODO: implements
    // }

    /// External functions

    /**
        @notice Create an ERC20 escrow
            Fee: The ratio is expressed in order of BASE
        @param _seller the seller address
        @param _buyer the buyer address
        @param _salt An entropy value, used to generate the id
        @return id of the escrow
    */
    function createEscrow(
        address _seller,
        address _buyer,
        address _token,
        uint256 _salt
    ) external returns (bytes32 id) {
        require(
            msg.sender != _seller,
            "createEscrow: the seller and sender must be different addresses"
        );
        id = _createEscrow(msg.sender, _seller, _buyer, _token, _salt);
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
        address _token,
        uint256 _salt
    ) external returns (bytes32 id) {
        id = _createEscrow(_agent, msg.sender, _buyer, _token, _salt);
        _deposit(id, _amount);
    }

    /**
        @notice deposit an amount to escrow
        @dev the seller of the escrow should be the sender
        @param _id escrow id
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

    function releaseWithAgentSignature(
        bytes32 _id,
        uint256 _amount,
        bytes calldata _agentSignature
    ) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.buyer &&
                escrow.agent ==
                ECDSA.recover(
                    ECDSA.toEthSignedMessageHash(_id),
                    _agentSignature
                ),
            "releaseWithAgentSignature: invalid sender or invalid agent signature"
        );

        (uint256 toAmount, uint256 agentFee) = _withdraw(
            _id,
            escrow.buyer,
            _amount
        );
        emit ReleaseWithAgentSignature(
            _id,
            escrow.seller,
            escrow.buyer,
            toAmount,
            agentFee
        );
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
        (uint256 toAmount, uint256 agentFee) = _withdraw(
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
        @notice Withdraw an amount from an escrow and the tokens send to seller address
        @dev the sender should be the buyer or the agent of the escrow

        @param _id escrow id
    */
    function buyerCancel(bytes32 _id) external {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.buyer || msg.sender == escrow.agent,
            "buyerCancel: the sender should be the buyer or the agent"
        );
        (uint256 toAmount, uint256 agentFee) = _withdraw(
            _id,
            escrow.seller,
            escrow.balance
        );
        emit BuyerCancel(_id, toAmount, agentFee);
    }

    /**
        @notice cancel an escrow and send the escrow balance to the seller address
        @dev the sender should be the agent
        @dev the escrow will be deleted
        @param _id escrow id
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

    function _calculateId(
        address _agent,
        address _seller,
        address _buyer,
        uint256 _agentFee,
        address _token,
        uint256 _salt
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    _agent,
                    _seller,
                    _buyer,
                    uint32(_agentFee),
                    _token,
                    _salt
                )
            );
    }

    function _deposit(bytes32 _id, uint256 _amount) internal {
        Escrow storage escrow = escrows[_id];
        require(
            msg.sender == escrow.seller,
            "deposit: The sender should be the seller"
        );

        uint256 platformFee = _feeAmount(_amount, escrows[_id].plataformFee);

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
        address _token,
        uint256 _salt
    ) internal returns (bytes32 id) {
        require(_token != address(0), "_createEscrow: address 0x is invalid");
        require(agents[_agent], "createEscrow: the agent is invalid");

        /// Calculate the escrow id
        uint256 agentFee = agentFeeByAgentAddress[_agent];
        id = _calculateId(_agent, _seller, _buyer, agentFee, _token, _salt);

        /// Check if the escrow was created
        require(
            escrows[id].agent == address(0),
            "createEscrow: The escrow exists"
        );

        /// Add escrow
        escrows[id] = Escrow({
            agent: _agent,
            seller: _seller,
            buyer: _buyer,
            fee: uint32(agentFee),
            plataformFee: uint32(fee),
            token: _token,
            balance: 0
        });

        emit CreateEscrow(
            id,
            _agent,
            _seller,
            _buyer,
            agentFee,
            fee,
            _token,
            _salt
        );
    }

    /**
        @notice Withdraw an amount from an escrow and send to _to address
        @dev The sender should be the _approved or the agent of the escrow
        @param _id escrow id
        @param _to the address where the tokens will go
        @param _amount the base amount
    */
    function _withdraw(
        bytes32 _id,
        address _to,
        uint256 _amount
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        Escrow storage escrow = escrows[_id];
        IERC20 token = IERC20(escrow.token);

        if (msg.sender == _owner) {
            /// the withdrawn was executed for plataform.
            /// the agent does not earn interest
            toAmount = _amount;
        } else {
            /// calculate the fee
            agentFee = _feeAmount(_amount, escrow.fee);
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
        @notice calculate fee amount
        @param _amount base amount
        @param _fee escrow agent fee
        @return calculated fee
    */
    function _feeAmount(uint256 _amount, uint256 _fee)
        internal
        pure
        returns (uint256)
    {
        return _amount.mul(_fee).div(BASE);
    }

    function _ecrecovery(bytes32 _hash, bytes memory _sig)
        internal
        pure
        returns (address)
    {
        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := and(mload(add(_sig, 65)), 255)
        }

        if (v < 27) {
            v += 27;
        }

        return ecrecover(_hash, v, r, s);
    }
}
