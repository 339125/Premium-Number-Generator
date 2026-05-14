var config = {
    prefix: "",
    suffix: "",
    threads: 4,
    rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/demo"
};

var stats = {
    generated: 0,
    checked: 0,
    found: 0,
    running: false
};

var savedWallets = [];
var workers = [];
var logs = [];

function sha3(data) {
    var buffer = data instanceof ArrayBuffer ? data : (typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.ByteBuffer.wrap(buffer));
}

function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] & 0xFF;
        hex.push((b < 16 ? '0' : '') + b.toString(16));
    }
    return hex.join('');
}

function hexToBytes(hex) {
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

function generatePrivateKey() {
    var random = java.security.SecureRandom.getInstanceStrong();
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32);
    random.nextBytes(bytes);
    return bytesToHex(java.util.Arrays.copyOf(bytes, bytes.length));
}

function privateKeyToPublicKey(privateKey) {
    var pk = hexToBytes(privateKey);
    var keySpec = new javax.crypto.spec.SecretKeySpec(pk, "EC");
    var keyFactory = java.security.KeyFactory.getInstance("EC");
    var params = java.security.spec.ECGenParameterSpec("secp256k1");
    var gen = java.security.KeyPairGenerator.getInstance("EC");
    gen.initialize(params);
    var ecParams = gen.generateKeyPair().getPublic().getParams();
    var w = org.bouncycastle.math.ec.ECPointUtil.decodePoint(ecParams.getCurve(), java.nio.ByteBuffer.wrap(pk));
    var publicPoint = w.multiply(new org.bouncycastle.math.BigInteger(privateKey, 16));
    return bytesToHex(publicPoint.getEncoded(false)).substring(2);
}

function publicKeyToAddress(publicKey) {
    var hash = sha3(hexToBytes(publicKey));
    return '0x' + bytesToHex(hash).substring(24);
}

function checkBalance(address) {
    try {
        var url = config.rpcUrl;
        var payload = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [address, "latest"],
            id: 1
        });
        var response = http.post(url, payload, {
            "Content-Type": "application/json"
        });
        var result = JSON.parse(response.body.string());
        if (result.result && result.result !== "0x0") {
            return parseInt(result.result, 16) / 1e18;
        }
    } catch (e) {
        log("Balance check error: " + e.message);
    }
    return 0;
}

function saveWallet(privateKey, address, balance) {
    var wallet = {
        privateKey: privateKey,
        address: address,
        balance: balance,
        timestamp: new Date().toLocaleString()
    };
    savedWallets.push(wallet);
    
    var content = JSON.stringify(savedWallets, null, 2);
    var file = new java.io.File(files.getSdcardPath() + "/ETH_Wallets.txt");
    files.write(file.getAbsolutePath(), content);
    
    log("发现有余额钱包! 地址: " + address + " 余额: " + balance + " ETH");
}

function generateAndCheck() {
    while (stats.running) {
        var privateKey = generatePrivateKey();
        var publicKey = privateKeyToPublicKey(privateKey);
        var address = publicKeyToAddress(publicKey);
        stats.generated++;
        
        var matchPrefix = !config.prefix || address.toLowerCase().startsWith("0x" + config.prefix.toLowerCase());
        var matchSuffix = !config.suffix || address.toLowerCase().endsWith(config.suffix.toLowerCase());
        
        if (matchPrefix && matchSuffix) {
            stats.checked++;
            var balance = checkBalance(address);
            if (balance > 0) {
                stats.found++;
                saveWallet(privateKey, address, balance);
            }
        }
        
        sleep(1);
    }
}

function startWorkers() {
    stats.running = true;
    for (var i = 0; i < config.threads; i++) {
        workers.push(threads.start(generateAndCheck));
    }
    updateUI();
}

function stopWorkers() {
    stats.running = false;
    workers = [];
    updateUI();
}

function updateUI() {
    ui.run(() => {
        ui.generated.setText("已生成: " + stats.generated);
        ui.checked.setText("已检查: " + stats.checked);
        ui.found.setText("已发现: " + stats.found);
        
        if (stats.running) {
            ui.startBtn.setText("停止");
            ui.prefix.setEnabled(false);
            ui.suffix.setEnabled(false);
            ui.threads.setEnabled(false);
        } else {
            ui.startBtn.setText("开始");
            ui.prefix.setEnabled(true);
            ui.suffix.setEnabled(true);
            ui.threads.setEnabled(true);
        }
        
        var listData = [];
        savedWallets.forEach((w, i) => {
            listData.push((i + 1) + ". " + w.address + " | " + w.balance + " ETH");
        });
        ui.walletList.setAdapter(android.widget.ArrayAdapter(
            context,
            android.R.layout.simple_list_item_1,
            listData
        ));
    });
}

function log(msg) {
    logs.unshift("[" + new Date().toLocaleTimeString() + "] " + msg);
    if (logs.length > 100) logs.pop();
    ui.run(() => {
        ui.logView.setText(logs.join("\n"));
    });
}

ui.layout(
    <vertical padding="16">
        <text text="ETH靓号生成器" textSize="24sp" textColor="#FFFFFF" gravity="center" marginBottom="16"/>
        
        <card backgroundColor="#2a2a2a" padding="12" marginBottom="12">
            <vertical>
                <text text="靓号规则设置" textSize="16sp" textColor="#AAAAAA" marginBottom="8"/>
                
                <horizontal marginBottom="8">
                    <text text="前缀: " textSize="14sp" textColor="#FFFFFF" width="60dp"/>
                    <input id="prefix" hint="如: 1111" textSize="14sp" width="150dp"/>
                </horizontal>
                
                <horizontal marginBottom="8">
                    <text text="后缀: " textSize="14sp" textColor="#FFFFFF" width="60dp"/>
                    <input id="suffix" hint="如: 1111" textSize="14sp" width="150dp"/>
                </horizontal>
                
                <horizontal>
                    <text text="线程: " textSize="14sp" textColor="#FFFFFF" width="60dp"/>
                    <input id="threads" text="4" textSize="14sp" width="80dp"/>
                </horizontal>
            </vertical>
        </card>
        
        <card backgroundColor="#2a2a2a" padding="12" marginBottom="12">
            <horizontal gravity="center">
                <text id="generated" text="已生成: 0" textSize="14sp" textColor="#FFFFFF" marginRight="20"/>
                <text id="checked" text="已检查: 0" textSize="14sp" textColor="#FFFFFF" marginRight="20"/>
                <text id="found" text="已发现: 0" textSize="14sp" textColor="#00FF00"/>
            </horizontal>
        </card>
        
        <button id="startBtn" text="开始" textSize="18sp" width="match_parent" height="50dp" marginBottom="12"
            onClick={() => {
                if (!stats.running) {
                    config.prefix = ui.prefix.getText().toString();
                    config.suffix = ui.suffix.getText().toString();
                    config.threads = parseInt(ui.threads.getText().toString()) || 4;
                    stats.generated = 0;
                    stats.checked = 0;
                    stats.found = 0;
                    logs = [];
                    startWorkers();
                    log("开始生成...");
                } else {
                    stopWorkers();
                    log("已停止");
                }
            }}/>
        
        <card backgroundColor="#2a2a2a" padding="12" marginBottom="12">
            <text text="日志" textSize="16sp" textColor="#AAAAAA" marginBottom="8"/>
            <scroll>
                <text id="logView" text="" textSize="12sp" textColor="#FFFFFF" maxLines="20"/>
            </scroll>
        </card>
        
        <card backgroundColor="#2a2a2a" padding="12">
            <text text="已保存的钱包" textSize="16sp" textColor="#AAAAAA" marginBottom="8"/>
            <list id="walletList" height="200dp"/>
        </card>
        
        <text text="钱包保存在: /sdcard/ETH_Wallets.txt" textSize="12sp" textColor="#666666" gravity="center" marginTop="12"/>
    </vertical>
);

ui.statusBarColor(0xFF1a1a1a);
ui.backgroundColor(0xFF1a1a1a);

if (files.exists(files.getSdcardPath() + "/ETH_Wallets.txt")) {
    try {
        savedWallets = JSON.parse(files.read(files.getSdcardPath() + "/ETH_Wallets.txt"));
        updateUI();
    } catch (e) {
        savedWallets = [];
    }
}

setInterval(() => {
    if (stats.running) {
        updateUI();
    }
}, 1000);