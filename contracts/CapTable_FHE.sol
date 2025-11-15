pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CapTableFHE is ZamaEthereumConfig {
    struct Shareholder {
        address id;
        euint32 encryptedShares;
        string encryptedMetadata;
        bool exists;
    }

    struct Company {
        string id;
        mapping(address => Shareholder) shareholders;
        address[] shareholderAddresses;
        euint32 totalEncryptedShares;
        bool exists;
    }

    mapping(string => Company) private companies;
    string[] private companyIds;

    event CompanyCreated(string companyId);
    event ShareholderAdded(string companyId, address shareholderId);
    event SharesUpdated(string companyId, address shareholderId);
    event TotalSharesUpdated(string companyId);

    modifier onlyExistingCompany(string calldata companyId) {
        require(companies[companyId].exists, "Company does not exist");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function createCompany(
        string calldata companyId,
        externalEuint32 initialTotalShares,
        bytes calldata totalSharesProof
    ) external {
        require(!companies[companyId].exists, "Company already exists");
        require(FHE.isInitialized(FHE.fromExternal(initialTotalShares, totalSharesProof)), "Invalid encrypted shares");

        Company storage newCompany = companies[companyId];
        newCompany.id = companyId;
        newCompany.totalEncryptedShares = FHE.fromExternal(initialTotalShares, totalSharesProof);
        newCompany.exists = true;

        FHE.allowThis(newCompany.totalEncryptedShares);
        FHE.makePubliclyDecryptable(newCompany.totalEncryptedShares);

        companyIds.push(companyId);

        emit CompanyCreated(companyId);
    }

    function addShareholder(
        string calldata companyId,
        address shareholderId,
        externalEuint32 encryptedShares,
        bytes calldata sharesProof,
        string calldata encryptedMetadata
    ) external onlyExistingCompany(companyId) {
        require(!companies[companyId].shareholders[shareholderId].exists, "Shareholder already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedShares, sharesProof)), "Invalid encrypted shares");

        Shareholder storage newShareholder = companies[companyId].shareholders[shareholderId];
        newShareholder.id = shareholderId;
        newShareholder.encryptedShares = FHE.fromExternal(encryptedShares, sharesProof);
        newShareholder.encryptedMetadata = encryptedMetadata;
        newShareholder.exists = true;

        FHE.allowThis(newShareholder.encryptedShares);
        FHE.makePubliclyDecryptable(newShareholder.encryptedShares);

        companies[companyId].shareholderAddresses.push(shareholderId);

        emit ShareholderAdded(companyId, shareholderId);
    }

    function updateShares(
        string calldata companyId,
        address shareholderId,
        externalEuint32 newEncryptedShares,
        bytes calldata sharesProof
    ) external onlyExistingCompany(companyId) {
        require(companies[companyId].shareholders[shareholderId].exists, "Shareholder does not exist");
        require(FHE.isInitialized(FHE.fromExternal(newEncryptedShares, sharesProof)), "Invalid encrypted shares");

        Shareholder storage shareholder = companies[companyId].shareholders[shareholderId];
        shareholder.encryptedShares = FHE.fromExternal(newEncryptedShares, sharesProof);

        FHE.allowThis(shareholder.encryptedShares);
        FHE.makePubliclyDecryptable(shareholder.encryptedShares);

        emit SharesUpdated(companyId, shareholderId);
    }

    function updateTotalShares(
        string calldata companyId,
        externalEuint32 newTotalEncryptedShares,
        bytes calldata totalSharesProof
    ) external onlyExistingCompany(companyId) {
        require(FHE.isInitialized(FHE.fromExternal(newTotalEncryptedShares, totalSharesProof)), "Invalid encrypted shares");

        Company storage company = companies[companyId];
        company.totalEncryptedShares = FHE.fromExternal(newTotalEncryptedShares, totalSharesProof);

        FHE.allowThis(company.totalEncryptedShares);
        FHE.makePubliclyDecryptable(company.totalEncryptedShares);

        emit TotalSharesUpdated(companyId);
    }

    function getCompanyShareholders(string calldata companyId) 
        external 
        view 
        onlyExistingCompany(companyId) 
        returns (address[] memory) 
    {
        return companies[companyId].shareholderAddresses;
    }

    function getShareholderEncryptedShares(string calldata companyId, address shareholderId)
        external
        view
        onlyExistingCompany(companyId)
        returns (euint32)
    {
        require(companies[companyId].shareholders[shareholderId].exists, "Shareholder does not exist");
        return companies[companyId].shareholders[shareholderId].encryptedShares;
    }

    function getShareholderEncryptedMetadata(string calldata companyId, address shareholderId)
        external
        view
        onlyExistingCompany(companyId)
        returns (string memory)
    {
        require(companies[companyId].shareholders[shareholderId].exists, "Shareholder does not exist");
        return companies[companyId].shareholders[shareholderId].encryptedMetadata;
    }

    function getTotalEncryptedShares(string calldata companyId) 
        external 
        view 
        onlyExistingCompany(companyId) 
        returns (euint32) 
    {
        return companies[companyId].totalEncryptedShares;
    }

    function getAllCompanyIds() external view returns (string[] memory) {
        return companyIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

