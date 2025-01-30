// SPDX-License-Identifier: MIT

/**
 * @title PowerloomNodes
 * @dev A contract for minting and managing Powerloom Snapshotter Nodes as Soul Bound Tokens (SBTs)
 *
 * This contract implements the following features:
 * - Mintable: Allows minting of new nodes
 * - Supply Tracking: Keeps track of the total supply of nodes
 * - Pausable: Can be paused in case of emergencies
 * - Updatable URI: Allows updating of token metadata URI
 * - Ownable: Has an owner with special privileges
 * - Transparent: Uses transparent proxy pattern for upgrades
 * - ReentrancyGuard: Prevents reentrancy attacks
 */

pragma solidity 0.8.24;

// Import OpenZeppelin contracts
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title PowerloomNodes
 * @dev Main contract for Powerloom Snapshotter Node management and minting
 */
contract PowerloomNodesUpgrade is Initializable, ERC1155Upgradeable, Ownable2StepUpgradeable, ERC1155PausableUpgradeable, ERC1155SupplyUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Struct to store vesting information for legacy nodes
     * @param owner Address of the node owner
     * @param initialClaim Amount of tokens initially claimed
     * @param tokensAfterInitialClaim Remaining tokens after initial claim
     * @param tokensClaimed Total amount of tokens claimed so far
     * @param lastClaim Timestamp of the last claim
     */
    struct LegacyNodeVestingInfo {
       address owner;
       uint256 initialClaim;
       uint256 tokensAfterInitialClaim;
       uint256 tokensClaimed;
       uint256 lastClaim;
    }


    /**
     * @dev Struct to store information about a node
     * @param nodeId Unique identifier for the node
     * @param snapshotterAddress Address of the snapshotter assigned to this node
     * @param lastUpdated Timestamp of the last update to this node
     * @param active Boolean indicating if the node is currently active
     */
    struct NodeInfo {
        address snapshotterAddress;
        uint256 nodePrice;
        uint256 amountSentOnL1;
        uint256 mintedOn;
        uint256 burnedOn;
        uint256 lastUpdated;
        bool isLegacy;
        bool claimedTokens;
        bool active;
        bool isKyced;
    }

    // State variables
    uint256 public nodePrice;
    uint256 public nodeCount;
    uint256 public enabledNodeCount;

    uint256 public legacyNodeCount;
    uint256 public legacyNodeInitialClaimPercentage;
    uint256 public legacyNodeCliff;
    uint256 public legacyNodeValue;
    uint256 public legacyTokensSentOnL1;
    uint256 public legacyNodeVestingDays;
    uint256 public legacyNodeVestingStart;
    uint256 public legacyNodeNonKycedCooldown;
    
    uint256 public mintStartTime;
    uint256 public snapshotterAddressChangeCooldown;
    uint256 public snapshotterTokenClaimCooldown;
    uint256 public MAX_SUPPLY;


    mapping(address => EnumerableSet.UintSet) private userTokenIds;
    mapping(address => EnumerableSet.UintSet) private snapshotterToNodeIds;
    mapping(uint256 => address) public nodeIdToOwner;
    mapping(uint256 => LegacyNodeVestingInfo) public nodeIdToVestingInfo;
    mapping(uint256 => bool) public isNodeBurned;
    mapping(address => EnumerableSet.UintSet) private burnedUserTokenIds;
    // Mapping to track all snapshotters
    mapping(address => bool) public allSnapshotters;
    mapping(uint256 => uint256) public lastSnapshotterChange;

    // Mapping of node ID to NodeInfo
    mapping(uint256 => NodeInfo) public nodeInfo;

    string public name;
    
    // Set of admin addresses
    EnumerableSet.AddressSet private adminSet;

    // Events
    event NodeMinted(address indexed to, uint256 nodeId);
    event NodeBurned(address indexed from, uint256 nodeId);
    event LegacyNodeTokensClaimed(address indexed claimer, uint256 nodeId, uint256 amount);
    event SnapshotterTokensClaimed(address indexed claimer, uint256 nodeId, uint256 amount);
    event ConfigurationUpdated(string paramName, uint256 newValue);
    event URIUpdated(string newUri);
    event NameUpdated(string newName);
    event EmergencyWithdraw(address indexed owner, uint256 amount);
    event Deposit(address indexed from, uint256 amount);
    event SnapshotterStateUpdated(address indexed newSnapshotterState);
    event allSnapshottersUpdated(address snapshotterAddress, bool allowed);
    event AdminsUpdated(address adminAddress, bool allowed);
    event SnapshotterAddressChanged(uint256 nodeId, address oldSnapshotter, address newSnapshotter);
    // receive ETH
    receive() external payable {}

    /**
     * @dev Modifier to restrict access to owner or admins
     */
    modifier onlyOwnerOrAdmin {
        require(owner() == msg.sender || adminSet.contains(msg.sender), "Only owner or admin can call this function!");
        _;
    }

    /**
     * @dev Function to update admin status for multiple addresses
     * @param _admins Array of admin addresses
     * @param _status Array of boolean status for each admin
     */
    function updateAdmins(address[] calldata _admins, bool[] calldata _status) external onlyOwner {
        require(_admins.length == _status.length, "Input lengths do not match");
        for (uint256 i = 0; i < _admins.length; i++) {
            if (_status[i]) {
                adminSet.add(_admins[i]);
            } else {
                adminSet.remove(_admins[i]);
            }
            emit AdminsUpdated(_admins[i], _status[i]);
        }
    }

    /**
     * @dev Function to get all admin addresses
     * @return Array of admin addresses
     */
    function getAdmins() public view returns(address[] memory) {
        return adminSet.values();
    }

    /**
     * @dev Function to update the maximum supply of nodes
     * @param _maxSupply The new maximum supply
     */
    function updateMaxSupply(uint256 _maxSupply) public onlyOwner {
        require(_maxSupply != 0, "E45");
        require(_maxSupply > nodeCount, "E46");
        MAX_SUPPLY = _maxSupply;
        emit ConfigurationUpdated("MaxSupply", _maxSupply);
    }

    /**
     * @dev Initializes the contract
     * @param initialOwner The address of the initial owner
     * @param initialNodePrice The initial price for minting a node
     * @param initialName The initial name of the token
     */
    function initialize(address initialOwner, uint256 initialNodePrice, string memory initialName) initializer public {
        __ERC1155_init("");
        __Ownable_init(initialOwner);
        __ERC1155Pausable_init();
        __ERC1155Supply_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(initialNodePrice > 0, "Node price must be greater than 0");
        nodePrice = initialNodePrice;
        name = initialName;
        MAX_SUPPLY = 10000;
    }

    /**
     * @dev Sets the URI for token metadata
     * @param newuri The new URI
     */
    function setURI(string memory newuri) public onlyOwner {
        _setURI(newuri);
        emit URIUpdated(newuri);
    }

    /**
     * @dev Configures legacy node parameters
     * @param _legacyNodeCount Number of legacy nodes
     * @param _legacyNodeInitialClaimPercentage Initial claim percentage for legacy nodes
     * @param _legacyNodeCliff Cliff period for legacy nodes in days
     * @param _legacyNodeValue Total value of legacy nodes
     * @param _legacyNodeVestingDays Vesting period for legacy nodes in days (includes cliff)
     * @param _legacyNodeVestingStart Start time for legacy node vesting
     * @param _legacyTokensSentOnL1 Amount of tokens sent on L1
     */
    function configureLegacyNodes(
        uint256 _legacyNodeCount, 
        uint256 _legacyNodeInitialClaimPercentage, 
        uint256 _legacyNodeCliff, 
        uint256 _legacyNodeValue,
        uint256 _legacyNodeVestingDays,
        uint256 _legacyNodeVestingStart,
        uint256 _legacyTokensSentOnL1,
        uint256 _legacyNodeNonKycedCooldown
    ) public onlyOwner {
        require(_legacyNodeInitialClaimPercentage <= 1e6, "Initial claim percentage must be less than 100%");
        require(_legacyNodeValue > 0, "Legacy node value must be greater than 0");
        require(_legacyTokensSentOnL1 < _legacyNodeValue, "Tokens sent on L1 must be less than the total node value");
        require(_legacyNodeVestingDays > _legacyNodeCliff, "Vesting days must be greater than the cliff period");
        legacyNodeCount = _legacyNodeCount;
        legacyNodeInitialClaimPercentage = _legacyNodeInitialClaimPercentage;
        legacyNodeCliff = _legacyNodeCliff;
        legacyNodeValue = _legacyNodeValue;
        legacyNodeVestingDays = _legacyNodeVestingDays;
        legacyNodeVestingStart = _legacyNodeVestingStart;
        legacyTokensSentOnL1 = _legacyTokensSentOnL1;
        legacyNodeNonKycedCooldown = _legacyNodeNonKycedCooldown;
        emit ConfigurationUpdated("LegacyNodesConfig", _legacyNodeCount);
    }

    /**
     * @dev Sets the start time for minting
     * @param _mintStartTime The start time for minting
     */
    function setMintStartTime(uint256 _mintStartTime) public onlyOwner {
        require(_mintStartTime != 0, "E45");
        mintStartTime = _mintStartTime;
        emit ConfigurationUpdated("MintStartTime", _mintStartTime);
    }

    /**
     * @dev Sets the cooldown for snapshotter address changes
     * @param _snapshotterAddressChangeCooldown The cooldown period in seconds
     */
    function setSnapshotterAddressChangeCooldown(uint256 _snapshotterAddressChangeCooldown) public onlyOwner {
        snapshotterAddressChangeCooldown = _snapshotterAddressChangeCooldown;
        emit ConfigurationUpdated("SnapshotterAddressChangeCooldown", _snapshotterAddressChangeCooldown);
    }

    /**
     * @dev Checks if a node is available
     * @param _nodeId The ID of the node to check
     * @return bool indicating if the node is available
     */
    function isNodeAvailable(uint256 _nodeId) public view returns (bool) {
        return !isNodeBurned[_nodeId] && _nodeId <= nodeCount;
    }

    /**
     * @dev Sets the name of the token
     * @param _name The new name
     */
    function setName(string memory _name) public onlyOwner {
        name = _name;
        emit NameUpdated(_name);
    }

    /**
     * @dev Pauses the contract
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev Updates the price of a node
     * @param _nodePrice The new price
     */
    function updateNodePrice(uint256 _nodePrice) public onlyOwner {
        require(_nodePrice > 0, "E45");
        nodePrice = _nodePrice;
        emit ConfigurationUpdated("NodePrice", _nodePrice);
    }

    /**
     * @dev Updates the cooldown for snapshotter token claims
     * @param _snapshotterTokenClaimCooldown The cooldown period in seconds
     */
    function setSnapshotterTokenClaimCooldown(uint256 _snapshotterTokenClaimCooldown) public onlyOwner {
        snapshotterTokenClaimCooldown = _snapshotterTokenClaimCooldown;
        emit ConfigurationUpdated("SnapshotterTokenClaimCooldown", _snapshotterTokenClaimCooldown);
    }

    /**
     * @dev Authorizes an upgrade to a new implementation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}

    /**
     * @dev Internal function to update token data
     * @param from Address tokens are transferred from
     * @param to Address tokens are transferred to
     * @param ids IDs of the tokens
     * @param values Amounts of the tokens
     */
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155Upgradeable, ERC1155PausableUpgradeable, ERC1155SupplyUpgradeable)
    {
        super._update(from, to, ids, values);
    }

    /**
     * @dev Gets the number of nodes owned by an address
     * @param _address The address to check
     * @return uint256 Number of nodes owned
     */
    function getNodesOwned(address _address) public view returns (uint256) {
        return userTokenIds[_address].length();
    }

    /**
     * @dev Gets the node IDs owned by an address
     * @param _address The address to check
     * @return uint256[] Array of node IDs owned
     */
    function getUserOwnedNodeIds(address _address) public view returns (uint256[] memory) {
        return userTokenIds[_address].values();
    }

    /**
     * @dev Gets the node IDs owned by an address, including burned ones
     * @param _address The address to check
     * @return uint256[] Array of node IDs including burned ones
     */
    function getAllUserNodeIds(address _address) public view returns (uint256[] memory) {
        uint256[] memory allNodeIds = new uint256[](userTokenIds[_address].length() + burnedUserTokenIds[_address].length());
        uint256 index = 0;
        for (uint256 i = 0; i < userTokenIds[_address].length(); i++) {
            allNodeIds[index++] = userTokenIds[_address].at(i);
        }
        for (uint256 i = 0; i < burnedUserTokenIds[_address].length(); i++) {
            allNodeIds[index++] = burnedUserTokenIds[_address].at(i);
        }
        return allNodeIds;
    }

    /**
     * @dev Gets the node IDs burned by an address
     * @param _address The address to check
     * @return uint256[] Array of node IDs burned
     */
    function getUserBurnedNodeIds(address _address) public view returns (uint256[] memory) {
        return burnedUserTokenIds[_address].values();
    }

    /**
     * @dev Disables transfers (SBT functionality)
     */
    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public virtual override {
        revert("Transfers are not allowed on SBTs");
    }

    /**
     * @dev Disables batch transfers (SBT functionality)
     */
    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory) public virtual override {
        revert("Transfers are not allowed on SBTs");
    }

    /**
     * @dev Completes the KYC process for a node
     * @param _nodeId ID of the node
     */
    function completeKyc(uint256 _nodeId) public onlyOwner {
        require(nodeInfo[_nodeId].isLegacy, "Node is not legacy");
        require(nodeInfo[_nodeId].isKyced == false, "Node is already KYCed");
        nodeInfo[_nodeId].isKyced = true;
    }

    /**
     * @dev Internal function to mint a node
     * @param amount Number of nodes to mint
     * @param _to Address to mint the nodes to
     */
    function _mintNode(uint256 amount, address _to, bool _isLegacy, bool _isKyced) internal {
        for (uint256 i = 0; i < amount; i++) {
            nodeCount++;
            if (_isLegacy){
                require(legacyNodeCount > 0, "Legacy nodes are not configured yet!");
                require(nodeCount <= legacyNodeCount, "Node count exceeds legacy node count");
            }
            else{
                require(nodeCount > legacyNodeCount, "Node count must be greater than legacy node count");
            }

            _mint(_to, nodeCount, 1, "");
            userTokenIds[_to].add(nodeCount);
            nodeIdToOwner[nodeCount] = _to;
            if (_isLegacy){
                nodeInfo[nodeCount] = NodeInfo(address(0), legacyNodeValue, legacyTokensSentOnL1, block.timestamp, 0, block.timestamp, true, false, false, _isKyced);
            }
            else{
                nodeInfo[nodeCount] = NodeInfo(address(0), nodePrice, 0, block.timestamp, 0, block.timestamp, false, false, false, _isKyced);
            }
            emit NodeMinted(_to, nodeCount);
        }
    }

    /**
     * @dev Mints a node
     * @param amount Number of nodes to mint
     */
    function mintNode(uint256 amount) public payable nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        require(block.timestamp >= mintStartTime, "Mint is not open yet");
        require(mintStartTime > 0, "Mint start time is not set");
        uint256 cost = amount * nodePrice;
        require(msg.value >= cost, "Not enough Power!");
        require (totalSupply()+amount <= MAX_SUPPLY, "Max supply reached");

        
        uint256 excessETH = msg.value - cost;
        if (excessETH > 0) {
            (bool success, ) = payable(msg.sender).call{value: excessETH}("");
            require(success, "Failed to send excess ETH");
        }
        _mintNode(amount, msg.sender, false, false);
    }

    /**
     * @dev Function to disable a node
     * @param _nodeId ID of the node to disable
     */
    function _disableNode(uint256 _nodeId) internal{
        NodeInfo storage node = nodeInfo[_nodeId];

        if (node.active){
            node.active = false;
            enabledNodeCount -= 1;
        }

        if (node.snapshotterAddress != address(0)){
            snapshotterToNodeIds[node.snapshotterAddress].remove(_nodeId);

            if (snapshotterToNodeIds[node.snapshotterAddress].length() == 0) {
                allSnapshotters[node.snapshotterAddress] = false;
                emit allSnapshottersUpdated(node.snapshotterAddress, false);
            }
            node.snapshotterAddress = address(0);
        }

        node.lastUpdated = block.timestamp;
    }

    /**
     * @dev Function to get the total count of snapshotters
     * @return Total number of snapshotters
     */
    function getTotalSnapshotterCount() public view returns(uint256) {
        return enabledNodeCount;
    }

    /**
     * @dev Function to get the snapshotter address for a given node ID
     * @param nodeId The ID of the node
     * @return Address of the snapshotter assigned to the node
     */
    function nodeSnapshotterMapping(uint256 nodeId) external view returns(address) {
        return nodeInfo[nodeId].snapshotterAddress;
    }

    function _assignSnapshotterToNode(uint256 nodeId, address snapshotterAddress) internal {
        require(snapshotterAddress != address(0), "Snapshotter address cannot be 0");
        // check node is not burned
        require(nodeInfo[nodeId].burnedOn == 0, "Node is burned");
        NodeInfo storage node = nodeInfo[nodeId];
        require(snapshotterAddress != node.snapshotterAddress, "Same address already assigned");
        // If the node already has a snapshotter address assigned, remove the previous snapshotter address
        if (node.snapshotterAddress != address(0)) {
            snapshotterToNodeIds[node.snapshotterAddress].remove(nodeId);
            
            // If this was the last node for the previous snapshotter, update allSnapshotters
            if (snapshotterToNodeIds[node.snapshotterAddress].length() == 0) {
                allSnapshotters[node.snapshotterAddress] = false;
                emit allSnapshottersUpdated(node.snapshotterAddress, false);
            }
        }

        if (!node.active) {
            // If it's a new node, increment the counter
            node.active = true;
            enabledNodeCount += 1;
        }
        
        // Assign the new snapshotter
        node.snapshotterAddress = snapshotterAddress;
        node.lastUpdated = block.timestamp;
        snapshotterToNodeIds[snapshotterAddress].add(nodeId);
        emit SnapshotterAddressChanged(nodeId, node.snapshotterAddress, snapshotterAddress);
        if (!allSnapshotters[snapshotterAddress]) {
            allSnapshotters[snapshotterAddress] = true;
            emit allSnapshottersUpdated(snapshotterAddress, true);
        }
    }

    /**
     * @dev Function to assign a snapshotter to a node
     * @param nodeId The ID of the node to assign
     * @param snapshotterAddress The address of the snapshotter to assign
     */
    function assignSnapshotterToNode(uint256 nodeId, address snapshotterAddress) public {
        NodeInfo memory node = nodeInfo[nodeId];
        require(nodeIdToOwner[nodeId] == msg.sender, "Only the owner can assign a snapshotter");
        if (snapshotterAddressChangeCooldown > 0){
            require(block.timestamp >= node.lastUpdated + snapshotterAddressChangeCooldown, "Snapshotter address change cooldown not yet met");
        }
        _assignSnapshotterToNode(nodeId, snapshotterAddress);
    }

    /**
     * @dev Function to assign a snapshotter to a node (Admin only)
     * @param nodeId The ID of the node to assign
     * @param snapshotterAddress The address of the snapshotter to assign
     */
    function assignSnapshotterToNodeAdmin(uint256 nodeId, address snapshotterAddress) public onlyOwnerOrAdmin {
        require(nodeId > 0 && nodeId <= nodeCount, "Node ID is out of bounds");
        _assignSnapshotterToNode(nodeId, snapshotterAddress);
    }

    /**
     * @dev Function to bulk assign snapshotters to nodes
     * @param nodeIds Array of node IDs
     * @param snapshotterAddresses Array of snapshotter addresses
     */
    function assignSnapshotterToNodeBulk(uint256[] calldata nodeIds, address[] calldata snapshotterAddresses) public {
        require(nodeIds.length == snapshotterAddresses.length, "Input lengths do not match");
        for (uint256 i = 0; i < nodeIds.length; i++) {
            assignSnapshotterToNode(nodeIds[i], snapshotterAddresses[i]);
        }
    }

    /**
     * @dev Function to bulk assign snapshotters to nodes (Admin only)
     * @param nodeIds Array of node IDs
     * @param snapshotterAddresses Array of snapshotter addresses
     */
    function assignSnapshotterToNodeBulkAdmin(uint256[] calldata nodeIds, address[] calldata snapshotterAddresses) public onlyOwnerOrAdmin {
        require(nodeIds.length == snapshotterAddresses.length, "Input lengths do not match");
        for (uint256 i = 0; i < nodeIds.length; i++) {
            assignSnapshotterToNodeAdmin(nodeIds[i], snapshotterAddresses[i]);
        }
    }

    /**
     * @dev Burns a node
     * @param _nodeId ID of the node to burn
     */
    function burnNode(uint256 _nodeId) public nonReentrant whenNotPaused {
        require(_nodeId > 0 && _nodeId <= nodeCount, "Node ID is out of bounds");
        require(nodeIdToOwner[_nodeId] == msg.sender, "Only the owner can burn their own node");
        if (nodeInfo[_nodeId].isLegacy && !nodeInfo[_nodeId].isKyced){
            require(block.timestamp >= legacyNodeVestingStart + legacyNodeNonKycedCooldown, "Non KYCed legacy nodes cannot be burned before lockup period");
        }
        _burn(msg.sender, _nodeId, 1);
        userTokenIds[msg.sender].remove(_nodeId);
        isNodeBurned[_nodeId] = true;
        burnedUserTokenIds[msg.sender].add(_nodeId);
        emit NodeBurned(msg.sender, _nodeId);
        _disableNode(_nodeId);
        nodeInfo[_nodeId].burnedOn = block.timestamp;

        
        if (nodeInfo[_nodeId].isLegacy){
            if (nodeInfo[_nodeId].isKyced){
                uint256 initialClaim = getLegacyInitialClaim();
                (bool success, ) = payable(msg.sender).call{value: initialClaim}("");
                require(success, "Failed to send initial claim");
                nodeIdToVestingInfo[_nodeId] = LegacyNodeVestingInfo(
                    msg.sender,
                    initialClaim,
                    (legacyNodeValue - legacyTokensSentOnL1 - initialClaim),
                    0,
                    block.timestamp
                );
            }
        }
        
    }

    /**
     * @dev Mints legacy nodes (admin function)
     * @param _to Address to mint the nodes to
     * @param _amount Number of nodes to mint
     */
    function adminMintLegacyNodes(address _to, uint256 _amount, bool _isKyced) public onlyOwner {
        require(_amount > 0, "Amount must be greater than 0");
        _mintNode(_amount, _to, true, _isKyced);
    }

    /**
     * @dev Calculates vested tokens for legacy nodes
     * @return uint256 Amount of vested tokens
     */
    function vestedLegacyNodeTokens() public view returns (uint256) {
        if (block.timestamp < legacyNodeVestingStart) {
            return 0;
        }
        uint256 PRECISION_FACTOR = 1e9;
        uint256 daysSinceVestingStarted = ((block.timestamp - legacyNodeVestingStart) * PRECISION_FACTOR) / 1 days;
        uint256 initialClaim = getLegacyInitialClaim();
        uint256 totalTokens = legacyNodeValue - initialClaim - legacyTokensSentOnL1;
        
        if (daysSinceVestingStarted/PRECISION_FACTOR < legacyNodeCliff) {
            return 0;
        }
        
        uint256 totalTimeToVest = legacyNodeVestingDays;

        if (daysSinceVestingStarted/PRECISION_FACTOR >= totalTimeToVest) {
            return totalTokens;
        }
        
        uint256 tokensVested = (totalTokens * (daysSinceVestingStarted - (legacyNodeCliff*PRECISION_FACTOR))) / ((totalTimeToVest - legacyNodeCliff) * PRECISION_FACTOR);
        return tokensVested;
    }

    /**
     * @dev Calculates claimable tokens for a legacy node
     * @param _nodeId ID of the node
     * @return uint256 Amount of claimable tokens
     */
    function claimableLegacyNodeTokens(uint256 _nodeId) public view returns (uint256) {
        LegacyNodeVestingInfo memory vestingInfo = nodeIdToVestingInfo[_nodeId];
        uint256 vestedTokens = vestedLegacyNodeTokens();
        return (vestedTokens - vestingInfo.tokensClaimed);
    }

    /**
     * @dev Calculates the initial claim value for legacy nodes
     * @return uint256 Amount of initial claim value
     */
    function getLegacyInitialClaim() public view returns (uint256) {
        return (legacyNodeInitialClaimPercentage * (legacyNodeValue - legacyTokensSentOnL1)) / 1e6;
    }


    /**
     * @dev Claimable Node Tokens
     * @param _nodeId ID of the node
     */
    function claimableNodeTokens(uint256 _nodeId) public view returns (uint256 _claimableNodeTokens) {
        NodeInfo memory node = nodeInfo[_nodeId];
        require(node.burnedOn > 0, "Need to Burn the Node First");
        require(nodeIdToOwner[_nodeId] == msg.sender, "Only the owner can claim their own tokens");       

        if (node.isLegacy){
            if (node.isKyced){
                _claimableNodeTokens = claimableLegacyNodeTokens(_nodeId);
            }
            else{
                require(block.timestamp >= legacyNodeVestingStart + legacyNodeNonKycedCooldown, "Legacy node non-kyced cooldown not yet met");
                require(node.claimedTokens == false, "Tokens already claimed");
                _claimableNodeTokens = node.nodePrice;

            }
        }
        else{
            require(block.timestamp >= node.burnedOn + snapshotterTokenClaimCooldown, "Snapshotter token claim cooldown not yet met");
            require(node.claimedTokens == false, "Tokens already claimed");

            _claimableNodeTokens = node.nodePrice;
        }

        return _claimableNodeTokens;
  
    }

    /**
     * @dev Claims tokens for a legacy node
     * @param _nodeId ID of the node
     */
    function claimNodeTokens(uint256 _nodeId) public nonReentrant whenNotPaused {
        NodeInfo storage node = nodeInfo[_nodeId];
        uint256 _claimableNodeTokens = claimableNodeTokens(_nodeId);

        if (node.isLegacy){
            if (node.isKyced){
                
                require(_claimableNodeTokens > 0, "No tokens to claim");
                
                LegacyNodeVestingInfo storage vestingInfo = nodeIdToVestingInfo[_nodeId];
                vestingInfo.tokensClaimed += _claimableNodeTokens;
                vestingInfo.lastClaim = block.timestamp;
                
                (bool success, ) = payable(msg.sender).call{value: _claimableNodeTokens}("");
                require(success, "Transfer failed");

                emit LegacyNodeTokensClaimed(msg.sender, _nodeId, _claimableNodeTokens);
            }
            else{
                node.claimedTokens = true;
                (bool success, ) = payable(msg.sender).call{value: _claimableNodeTokens}("");
                require(success, "Failed to send legacy node tokens");
                emit LegacyNodeTokensClaimed(msg.sender, _nodeId, _claimableNodeTokens);
            }
        }
        else{

            node.claimedTokens = true;
            (bool success, ) = payable(msg.sender).call{value: _claimableNodeTokens}("");
            require(success, "Failed to send snapshotter tokens");
            emit SnapshotterTokensClaimed(msg.sender, _nodeId, _claimableNodeTokens);
        }
    }


    /**
     * @dev Allows the owner to withdraw all funds from the contract in case of emergency
     */
    function emergencyWithdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Failed to send funds");
        emit EmergencyWithdraw(msg.sender, balance);
    }


    function newFunctionality() public pure returns (string memory) {
        string memory newFunctionalityString = "This is a new functionality";
        return newFunctionalityString;
    }

}
