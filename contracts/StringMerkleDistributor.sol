// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "./interfaces/IStringMerkleDistributor.sol";

contract StringMerkleDistributor is IStringMerkleDistributor {
    address public immutable override token;
    bytes32 public immutable override merkleRoot;

    // This is a packed array of booleans.
    mapping(uint256 => uint256) private claimedBitMap;

    constructor(address token_, bytes32 merkleRoot_) public {
        token = token_;
        merkleRoot = merkleRoot_;
    }

    function isClaimed(uint256 index) public view override returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        claimedBitMap[claimedWordIndex] = claimedBitMap[claimedWordIndex] | (1 << claimedBitIndex);
    }

    function claim(
        uint256 index,
        string memory target,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) virtual public override {
        require(!isClaimed(index), 'StringMerkleDistributor: Drop already claimed.');

        // Verify the merkle proof.
        bytes32 hashed = keccak256(abi.encodePacked(target));
        bytes32 node = keccak256(abi.encodePacked(index, hashed, amount));
        require(MerkleProof.verify(merkleProof, merkleRoot, node), 'StringMerkleDistributor: Invalid proof.');

        // Mark it claimed and send the token.
        _setClaimed(index);
        require(IERC20(token).transfer(msg.sender, amount), 'StringMerkleDistributor: Transfer failed.');

        emit Claimed(index, msg.sender, amount);
    }
}
