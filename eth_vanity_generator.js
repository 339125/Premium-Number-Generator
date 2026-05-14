'ui';

var config = {
    prefix: "",
    suffix: "",
    threads: 64
};

var stats = {
    generated: 0,
    checked: 0,
    found: 0,
    running: false
};

var savedWallets = [];
var workers = [];

console.show();
console.hide();

function log(msg) {
    console.log(msg);
    ui.post(() => {
        try {
            ui.logView.setText(ui.logView.text() + "\n" + msg);
        } catch (e) {}
    });
}

function generatePrivateKey() {
    var random = java.security.SecureRandom.getInstanceStrong();
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32);
    random.nextBytes(bytes);
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] & 0xFF;
        hex.push((b < 16 ? '0' : '') + b.toString(16));
    }
    return hex.join('');
}

function privateKeyToPublicKey(privateKey) {
    try {
        var curve = org.bouncycastle.jce.ECNamedCurveTable.getParameterSpec("secp256k1");
        var point = curve.getG().multiply(new java.math.BigInteger(privateKey, 16));
        var encoded = point.getEncoded(false);
        var hex = [];
        for (var i = 1; i < encoded.length; i++) {
            var b = encoded[i] & 0xFF;
            hex.push((b < 16 ? '0' : '') + b.toString(16));
        }
        return hex.join('');
    } catch (e) {
        return "";
    }
}

function publicKeyToAddress(publicKey) {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    var hash = digest.digest(java.nio.ByteBuffer.wrap(hexToBytes(publicKey)));
    var hex = [];
    for (var i = 0; i < hash.length; i++) {
        var b = hash[i] & 0xFF;
        hex.push((b < 16 ? '0' : '') + b.toString(16));
    }
    return '0x' + hex.join('').substring(24);
}

function hexToBytes(hex) {
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

function checkBalance(address) {
    try {
        var payload = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [address, "latest"],
            id: 1
        });
        var response = http.post("https://eth-mainnet.g.alchemy.com/v2/demo", payload, {
            "Content-Type": "application/json",
            "connectTimeout": 10000,
            "readTimeout": 10000
        });
        var result = JSON.parse(response.body.string());
        if (result.result) {
            return parseInt(result.result, 16) / 1e18;
        }
    } catch (e) {}
    return 0;
}

function saveWallet(privateKey, address, balance) {
    var wallet = {
        privateKey: privateKey,
        address: address,
        balance: balance,
        time: new Date().toLocaleString()
    };
    savedWallets.push(wallet);
    files.write(files.getSdcardPath() + "/ETH_Wallets.txt", JSON.stringify(savedWallets, null, 2));
    log("发现! " + address + " = " + balance + " ETH");
}

function generateAndCheck() {
    while (stats.running) {
        try {
            var pk = generatePrivateKey();
            var pub = privateKeyToPublicKey(pk);
            var addr = publicKeyToAddress(pub);
            
            stats.generated++;
            
            var match = true;
            if (config.prefix && !addr.toLowerCase().startsWith("0x" + config.prefix.toLowerCase())) match = false;
            if (config.suffix && !addr.toLowerCase().endsWith(config.suffix.toLowerCase())) match = false;
            
            if (match) {
                stats.checked++;
                var bal = checkBalance(addr);
                if (bal > 0) {
                    stats.found++;
                    saveWallet(pk, addr, bal);
                }
            }
        } catch (e) {}
        sleep(1);
    }
}

function startWorkers() {
    stats.running = true;
    stats.generated = 0;
    stats.checked = 0;
    stats.found = 0;
    
    config.prefix = ui.prefix.text();
    config.suffix = ui.suffix.text();
    config.threads = parseInt(ui.threads.text()) || 64;
    
    log("开始生成... 前缀:" + config.prefix + " 后缀:" + config.suffix + " 线程:" + config.threads);
    
    for (var i = 0; i < config.threads; i++) {
        workers.push(threads.start(generateAndCheck));
    }
    
    ui.startBtn.setText("停止");
    updateUI();
}

function stopWorkers() {
    stats.running = false;
    workers.forEach(function(w) { if (w) w.join(1000); });
    workers = [];
    ui.startBtn.setText("开始");
    updateUI();
    log("已停止");
}

function updateUI() {
    ui.post(() => {
        ui.gen.setText("生成:" + stats.generated);
        ui.chk.setText("检查:" + stats.checked);
        ui.fnd.setText("发现:" + stats.found);
        ui.wal.setText("钱包:" + savedWallets.length);
    });
}

ui.layout(
    <vertical>
        <text text="ETH靓号生成器" textSize="20sp" gravity="center"/>
        
        <horizontal>
            <text text="前缀:" w="60dp"/>
            <input id="prefix" hint="1111" w="100dp"/>
            <text text="后缀:" w="60dp"/>
            <input id="suffix" hint="8888" w="100dp"/>
        </horizontal>
        
        <horizontal>
            <text text="线程:" w="60dp"/>
            <input id="threads" text="64" w="80dp"/>
        </horizontal>
        
        <horizontal>
            <text id="gen" text="生成:0" w="80dp"/>
            <text id="chk" text="检查:0" w="80dp"/>
            <text id="fnd" text="发现:0" w="80dp"/>
            <text id="wal" text="钱包:0" w="80dp"/>
        </horizontal>
        
        <button id="startBtn" text="开始" w="100dp" h="50dp"/>
        
        <scroll h="200dp">
            <text id="logView" text="准备就绪\n"/>
        </scroll>
    </vertical>
);

ui.startBtn.on("click", () => {
    if (stats.running) {
        stopWorkers();
    } else {
        startWorkers();
    }
});

setInterval(updateUI, 500);

toast("已启动");