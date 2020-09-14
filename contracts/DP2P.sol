// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";

contract DP2P is Ownable {
    using SafeMath for uint256;
    using ECDSA for bytes32;

    /// User Events

    event CreateAndDeposit(
        bytes32 _id,
        address _agent,
        address _seller,
        address _buyer,
        uint256 _balance,
        uint256 _platformAmount,
        address _token
    );
    event ReleaseWithSellerSignature(
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

    uint256 internal constant BASE = 10000;
    uint256 internal constant MAX_PLATFORM_FEE = 100;
    uint256 internal constant MAX_AGENT_FEE = 1000;
    uint256 public platformFee;

    mapping(address => uint256) public platformBalanceByToken;
    mapping(address => uint256) public agentFeeByAgentAddress;
    mapping(bytes32 => bytes) public escrows;

    function setPlatformFee(uint32 _platformFee) external onlyOwner {
        require(
            _platformFee <= MAX_PLATFORM_FEE,
            "setPlatformFee: invalid-fee"
        );
        platformFee = _platformFee;
        emit SetFee(_platformFee);
    }

    function platformWithdraw(address[] calldata _tokenAddresses, address _to)
        external
        onlyOwner
    {
        require(_to != address(0), "platformWithdraw: error-transfer");
        for (uint256 i = 0; i < _tokenAddresses.length; i++) {
            address tokenAddress = _tokenAddresses[i];
            uint256 amount = platformBalanceByToken[tokenAddress];
            platformBalanceByToken[tokenAddress] = 0;
            require(
                IERC20(tokenAddress).transfer(_to, amount),
                "platformWithdraw: error-transfer"
            );
        }
    }

    function newAgent(address _agentAddress, uint256 _fee) external onlyOwner {
        require(_agentAddress != address(0), "newAgent: invalid-address");
        require(_fee > 0, "newAgent: invalid-fee");
        require(_fee <= MAX_AGENT_FEE, "newAgent: invalid-agent-fee");
        require(
            agentFeeByAgentAddress[_agentAddress] == 0,
            "newAgent: invalid agent"
        );
        agentFeeByAgentAddress[_agentAddress] = _fee;
        emit NewAgent(_agentAddress, _fee);
    }

    function removeAgent(address _agentAddress) external onlyOwner {
        require(_agentAddress != address(0), "removeAgent: invalid-address");
        require(
            agentFeeByAgentAddress[_agentAddress] > 0,
            "removeAgent: invalid-agent"
        );
        delete agentFeeByAgentAddress[_agentAddress];
        emit RemoveAgent(_agentAddress);
    }

    /**
        @notice deposit an amount in the escrow after creating this
        @dev create and deposit operation in one transaction,
             the seller of the escrow should be the sender
        @return id of the escrow
    */
    function createAndDeposit(
        uint256 _amount,
        address _agent,
        address _buyer,
        address _token,
        uint256 _salt
    ) public returns (bytes32 id) {
        require(_token != address(0), "createAndDeposit: invalid-address");
        require(
            agentFeeByAgentAddress[_agent] > 0,
            "createAndDeposit: invalid-agent"
        );
        address seller = msg.sender;
        // Calculate the escrow id
        uint256 agentFee = agentFeeByAgentAddress[_agent];

        id = _calculateId(_agent, seller, _buyer, agentFee, _token, _salt);
        /// Check if the escrow was created
        (address agent, , , , , ) = decodeEscrow(escrows[id]);
        require(agent == address(0), "createAndDeposit: invalid-escrow");

        // Transfer the tokens from the sender
        IERC20 token = IERC20(_token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "createAndDeposit: error-deposit"
        );

        // Assign the fee amount to platform
        uint256 platformAmount = _feeAmount(_amount, platformFee);
        platformBalanceByToken[_token] = platformBalanceByToken[_token].add(
            platformAmount
        );

        uint256 balance = _amount.sub(platformAmount);
        escrows[id] = encodeEscrow(
            _agent,
            seller,
            _buyer,
            _token,
            balance,
            agentFee
        );

        emit CreateAndDeposit(
            id,
            _agent,
            seller,
            _buyer,
            balance,
            platformAmount,
            _token
        );
    }

    /**
        @notice relase an amount from an escrow and send the tokens to the buyer address
        @dev the sender should be the buyer with the seller signature
    */
    function releaseWithSellerSignature(
        bytes32 _id,
        bytes calldata _sellerSignature
    ) external {
        (, address seller, address buyer, , uint256 balance, ) = decodeEscrow(
            escrows[_id]
        );
        require(
            msg.sender == buyer && seller == getSigner(_id, _sellerSignature),
            "releaseWithSellerSignature: invalid-sender-or-signature"
        );

        (uint256 toAmount, uint256 agentFee) = _withdrawWithFee(
            _id,
            buyer,
            balance
        );
        emit ReleaseWithSellerSignature(_id, seller, buyer, toAmount, agentFee);
    }

    /**
        @notice relase an amount from an escrow and send the tokens to the buyer address
        @dev the sender should be the buyer with the agent signature
    */
    function releaseWithAgentSignature(
        bytes32 _id,
        bytes calldata _agentSignature
    ) external {
        (
            address agent,
            address seller,
            address buyer,
            ,
            uint256 balance,

        ) = decodeEscrow(escrows[_id]);
        require(
            msg.sender == buyer && agent == getSigner(_id, _agentSignature),
            "releaseWithAgentSignature: invalid-sender-or-signature"
        );

        (uint256 toAmount, uint256 agentFee) = _withdrawWithFee(
            _id,
            buyer,
            balance
        );
        emit ReleaseWithAgentSignature(_id, seller, buyer, toAmount, agentFee);
    }

    function resolveDisputeSeller(bytes32 _id, bytes calldata _agentSignature)
        external
    {
        (address agent, address seller, , , uint256 balance, ) = decodeEscrow(
            escrows[_id]
        );
        resolveDispute(_id, balance, seller, agent, _agentSignature);
    }

    function resolveDisputeBuyer(bytes32 _id, bytes calldata _agentSignature)
        external
    {
        (address agent, , address buyer, , uint256 balance, ) = decodeEscrow(
            escrows[_id]
        );
        resolveDispute(_id, balance, buyer, agent, _agentSignature);
    }

    /**
        @notice Withdraw an amount from an escrow and the tokens send to seller address
        @dev the sender should be the buyer of the escrow
        @param _id escrow id
    */
    function buyerCancel(bytes32 _id) external {
        (, address seller, address buyer, , uint256 balance, ) = decodeEscrow(
            escrows[_id]
        );
        require(msg.sender == buyer, "buyerCancel: invalid-sender");
        (uint256 toAmount, uint256 agentFee) = _withdrawWithoutFee(
            _id,
            seller,
            balance
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
        (
            address agent,
            address seller,
            ,
            address token,
            uint256 balance,

        ) = decodeEscrow(escrows[_id]);
        require(
            msg.sender == agent || msg.sender == _owner,
            "cancel: invalid-sender"
        );

        /// Delete escrow
        delete escrows[_id];

        /// transfer tokens to the seller just if the escrow has balance
        if (balance > 0) {
            require(
                IERC20(token).transfer(seller, balance),
                "cancel: error-transfer"
            );
        }
        emit Cancel(_id, balance);
    }

    /// Internal functions

    function encodeEscrow(
        address agent,
        address seller,
        address buyer,
        address token,
        uint256 balance,
        uint256 agentFee
    ) internal pure returns (bytes memory) {
        return abi.encode(agent, seller, buyer, token, balance, agentFee);
    }

    function decodeEscrow(bytes memory _data)
        public
        pure
        returns (
            address agent,
            address seller,
            address buyer,
            address token,
            uint256 balance,
            uint256 agentFee
        )
    {
        if (_data.length > 0) {
            (agent, seller, buyer, token, balance, agentFee) = abi.decode(
                _data,
                (address, address, address, address, uint256, uint256)
            );
        }
    }

    function resolveDispute(
        bytes32 _id,
        uint256 _balance,
        address _sender,
        address _agent,
        bytes calldata _agentSignature
    ) internal {
        require(
            (msg.sender == _sender &&
                _agent == getSigner(_id, _agentSignature)) ||
                msg.sender == _owner,
            "resolveDispute: invalid-sender-or-signature"
        );
        (uint256 toAmount, uint256 agentFee) = _withdrawWithFee(
            _id,
            _sender,
            _balance
        );
        emit DisputeResolved(_id, _agent, _sender, toAmount, agentFee);
    }

    function getSigner(bytes32 _data, bytes memory _signature)
        internal
        pure
        returns (address)
    {
        bytes32 messageHash = _data.toEthSignedMessageHash();
        return messageHash.recover(_signature);
    }

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
                    _agentFee,
                    _token,
                    _salt
                )
            );
    }

    function _withdrawWithFee(
        bytes32 _id,
        address _to,
        uint256 _amount
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        return _withdraw(_id, _to, _amount, true);
    }

    function _withdrawWithoutFee(
        bytes32 _id,
        address _to,
        uint256 _amount
    ) internal returns (uint256 toAmount, uint256 agentFee) {
        return _withdraw(_id, _to, _amount, false);
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
        uint256 _amount,
        bool _withAgentFee
    ) internal returns (uint256 toAmount, uint256 agentAmount) {
        (
            address agent,
            address seller,
            address buyer,
            address token,
            uint256 balance,
            uint256 agentFee
        ) = decodeEscrow(escrows[_id]);
        require(balance > 0, "_withdraw: not-balance");

        if (msg.sender == _owner) {
            // platform should not pay fee (override withFee to false)
            _withAgentFee = false;
            toAmount = _amount;
        }

        if (_withAgentFee) {
            /// calculate the fee
            agentAmount = _feeAmount(_amount, agentFee);
            /// substract the agent fee
            balance = balance.sub(agentAmount);
            toAmount = _amount.sub(agentAmount);
            /// send fee to the agent
            require(
                IERC20(token).transfer(agent, agentAmount),
                "_withdraw: error-transfer-agent"
            );
        }
        /// update escrow balance in storage
        balance = balance.sub(toAmount);
        escrows[_id] = encodeEscrow(
            agent,
            seller,
            buyer,
            token,
            balance,
            agentFee
        );
        /// send amount to `_to` address
        require(
            IERC20(token).transfer(_to, toAmount),
            "_withdraw: error-transfer-to"
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
}
