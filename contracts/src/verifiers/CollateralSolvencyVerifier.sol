// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract CollateralSolvencyVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 10741729674420732284761717054056470331157037022695697297897588944329053667025;
    uint256 constant alphay  = 10865695504809370610115254513571797910551050809607618649004912977577578571363;
    uint256 constant betax1  = 279205345386186536091934813402882090695434661211885528221020919490248317545;
    uint256 constant betax2  = 6506611018006023486692482333045277982861554170303529683551783443488576676091;
    uint256 constant betay1  = 15971372540283646862600378201728811821609300667625640692676735857022523291808;
    uint256 constant betay2  = 9649630772512606029555975190278546223028485226732706362181998461030118016590;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 15999038205468438170137986624057996361183196808428462163273363649557002122844;
    uint256 constant deltax2 = 3050955145096748641371064056363925023103061940566985271873545971637165271000;
    uint256 constant deltay1 = 4594399629310044354259071870185366272163758964200769548192880065903930194394;
    uint256 constant deltay2 = 8256138883035388617182414284457741254251905285094625221173407951764705261582;

    
    uint256 constant IC0x = 20687020230109222491925800645470951601070573914603710722829598278231026808387;
    uint256 constant IC0y = 4811060172963835190484940003246744232843712624749385434137891824647330706866;
    
    uint256 constant IC1x = 42921516853002573256501134915135543827160571426844746219334345502863969967;
    uint256 constant IC1y = 3449302455516829514112404020308918919242727442914663888495417479388226452405;
    
    uint256 constant IC2x = 1583532033919357352014716165252512908590652599613673170719041338026001452226;
    uint256 constant IC2y = 15638588468690571272880011794194311025879160158901160223579963849895254065904;
    
    uint256 constant IC3x = 15329272978677670938548009570073145437955826865888034509905688276745589175501;
    uint256 constant IC3y = 3505061750440720558537026459539428209393381659385794326836547330425608447220;
    
    uint256 constant IC4x = 3271275769078596735779725033957091862690927656031642437702195291415794308860;
    uint256 constant IC4y = 5753181638214449907556257005152492807055939007925182298447766388525097663463;
    
    uint256 constant IC5x = 14657318994874669333282494081531920506752286940944296236448274953570168354190;
    uint256 constant IC5y = 11125274069686219898770115650458568234993913632793348011270504118732687630972;
    
    uint256 constant IC6x = 11398542895441323921190313263814360710334666234873298295134903536388960804770;
    uint256 constant IC6y = 2064255098434959350783583435635643113715285155294796845239017990906996423328;
    
    uint256 constant IC7x = 10825088781878894113993619307589862267292881310516038715711531765993186640421;
    uint256 constant IC7y = 3069851975669823898597294289023974832217247988234077679730981220296221956587;
    
    uint256 constant IC8x = 5419784405285336722298696832237278621700149478652973281595725326531716865658;
    uint256 constant IC8y = 3612319929303032711348025168738039107912074959531276010571272769943615063754;
    
    uint256 constant IC9x = 16963851990444597094203837637978819493152972630787159046303023733902206160948;
    uint256 constant IC9y = 1192934921974089841803614128329213922924660005617381482140071943028362491056;
    
    uint256 constant IC10x = 6022769856971099258146321021536700584882801119630210974183531223293985777611;
    uint256 constant IC10y = 9375353437192142128516055159020430040856699113448036863804588871994401698536;
    
    uint256 constant IC11x = 13249562472806141872998154875306456890423419686949290262202585204500866858249;
    uint256 constant IC11y = 21427077714816416153111707856806274342542972124090742847244901409581766181048;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[11] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
