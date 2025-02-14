import { ethers, network } from "hardhat";
import hre from "hardhat";
import fs from "fs";

async function verifyContract(address: string, constructorArguments: any[] = []) {
  if (network.name === "hardhat" || network.name === "localhost") return;
  
  console.log("Waiting for block confirmations...");
  await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

  try {
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    console.log(`Contract verified at ${address}`);
  } catch (error: any) {
    if (error.message.toLowerCase().includes("already verified")) {
      console.log("Contract already verified!");
    } else {
      console.error("Error verifying contract:", error);
    }
  }
}

async function main() {
  try {
    console.log("Starting deployment process...");
    
    // Deploy Mock NFT for testing
    console.log("\nDeploying MockNFT...");
    const Nft = await ethers.getContractFactory("MockNFT");
    const mockNFT = await Nft.deploy();
    await mockNFT.waitForDeployment();
    const mockNFTAddress = await mockNFT.getAddress();
    console.log(`MockNFT deployed to: ${mockNFTAddress}`);

    // Deploy SealedBidAuction
    console.log("\nDeploying SealedBidAuction...");
    const SealedBidAuction = await ethers.getContractFactory("SealedBidAuction");
    const auction = await SealedBidAuction.deploy();
    await auction.waitForDeployment();
    const auctionAddress = await auction.getAddress();
    console.log(`SealedBidAuction deployed to: ${auctionAddress}`);

    // Log deployment summary
    console.log("\nDeployment Summary:");
    console.log("-------------------");
    console.log(`Network: ${network.name}`);
    console.log(`MockNFT: ${mockNFTAddress}`);
    console.log(`SealedBidAuction: ${auctionAddress}`);

    // Save deployment addresses
    const deployments = {
      network: network.name,
      mockNFT: mockNFTAddress,
      sealedBidAuction: auctionAddress,
      timestamp: new Date().toISOString()
    };

    const deploymentsDir = "./deployments";
    if (!fs.existsSync(deploymentsDir)){
      fs.mkdirSync(deploymentsDir);
    }

    fs.writeFileSync(
      `${deploymentsDir}/${network.name}.json`,
      JSON.stringify(deployments, null, 2)
    );

    // Start verification process
    if (network.name !== "hardhat" && network.name !== "localhost") {
      console.log("\nStarting contract verification...");
      
      // Verify MockNFT
      await verifyContract(mockNFTAddress, []);
      
      // Verify SealedBidAuction
      await verifyContract(auctionAddress, []);
    }

    console.log("\nDeployment completed successfully!");
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});