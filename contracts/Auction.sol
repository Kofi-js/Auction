// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SealedBidAuction is ReentrancyGuard {
    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 minPrice;
        uint256 biddingEnd;
        uint256 revealEnd;
        bool ended;
        address highestBidder;
        uint256 highestBid;
    }

    // Custom errors
    error AuctionNotStarted();
    error AuctionFinalized();
    error BiddingPeriodEnded();
    error RevealPeriodEnded();
    error BiddingPeriodNotEnded();
    error InvalidBid();
    error RefundFailed();
    error TransferFailed();
    error UnauthorizedCaller();
    error InvalidReveal();

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => uint256)) public deposits;
    
    uint256 public nextAuctionId;

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, uint256 minPrice);
    event BidCommitted(uint256 indexed auctionId, address indexed bidder, bytes32 commitment);
    event BidRevealed(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionEnded(uint256 indexed auctionId, address winner, uint256 amount);

    function createAuction(
        address _nftContract,
        uint256 _tokenId,
        uint256 _minPrice,
        uint256 _biddingTime,
        uint256 _revealTime
    ) external returns (uint256) {
        IERC721(_nftContract).transferFrom(msg.sender, address(this), _tokenId);
        
        uint256 auctionId = nextAuctionId++;
        
        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: _nftContract,
            tokenId: _tokenId,
            minPrice: _minPrice,
            biddingEnd: block.timestamp + _biddingTime,
            revealEnd: block.timestamp + _biddingTime + _revealTime,
            ended: false,
            highestBidder: address(0),
            highestBid: 0
        });

        emit AuctionCreated(auctionId, msg.sender, _minPrice);
        return auctionId;
    }

    function commitBid(uint256 _auctionId, bytes32 _commitment) external payable nonReentrant {
        Auction storage auction = auctions[_auctionId];
        
        if (block.timestamp >= auction.biddingEnd) revert BiddingPeriodEnded();
        if (auction.ended) revert AuctionFinalized();

        commitments[_auctionId][msg.sender] = _commitment;
        deposits[_auctionId][msg.sender] = msg.value;

        emit BidCommitted(_auctionId, msg.sender, _commitment);
    }

    function revealBid(
        uint256 _auctionId,
        uint256 _amount,
        bytes32 _nonce
    ) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        
        if (block.timestamp <= auction.biddingEnd) revert BiddingPeriodNotEnded();
        if (block.timestamp >= auction.revealEnd) revert RevealPeriodEnded();
        
        bytes32 commitment = commitments[_auctionId][msg.sender];
        if (keccak256(abi.encodePacked(_amount, _nonce)) != commitment) {
            revert InvalidReveal();
        }

        uint256 deposit = deposits[_auctionId][msg.sender];
        if (_amount > deposit) revert InvalidBid();

        if (_amount > auction.highestBid && _amount >= auction.minPrice) {
            // Refund the previous highest bidder
            if (auction.highestBidder != address(0)) {
                _refund(auction.highestBidder, auction.highestBid);
            }
            
            auction.highestBid = _amount;
            auction.highestBidder = msg.sender;
        } else {
            _refund(msg.sender, deposit);
        }

        emit BidRevealed(_auctionId, msg.sender, _amount);
    }

    function endAuction(uint256 _auctionId) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        
        if (block.timestamp < auction.revealEnd) revert RevealPeriodEnded();
        if (auction.ended) revert AuctionFinalized();

        auction.ended = true;

        if (auction.highestBidder != address(0)) {
            // Transfer NFT to winner
            IERC721(auction.nftContract).transferFrom(
                address(this),
                auction.highestBidder,
                auction.tokenId
            );
            
            // Transfer funds to seller
            _transferFunds(auction.seller, auction.highestBid);
        } else {
            // Return NFT to seller if no valid bids
            IERC721(auction.nftContract).transferFrom(
                address(this),
                auction.seller,
                auction.tokenId
            );
        }

        emit AuctionEnded(_auctionId, auction.highestBidder, auction.highestBid);
    }

    function _refund(address _bidder, uint256 _amount) private {
        (bool success, ) = _bidder.call{value: _amount}("");
        if (!success) revert RefundFailed();
    }

    function _transferFunds(address _recipient, uint256 _amount) private {
        (bool success, ) = _recipient.call{value: _amount}("");
        if (!success) revert TransferFailed();
    }

    // Helper function to generate commitment
    function generateCommitment(uint256 _bid, bytes32 _nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_bid, _nonce));
    }
}