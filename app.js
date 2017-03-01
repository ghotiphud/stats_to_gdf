const fs = require('fs');

let fileName = process.argv[2];

fs.readFile(fileName, (err, data) => {
	var stats = load(JSON.parse(data));

	console.log(buildGDF(stats));
});


function load(stats) {
	stats.assets = stats.assets || [];
	stats.assets.sort(function(a, b) {
		return b.size - a.size;
	});
	stats.modules.sort(function(a, b) {
		return a.id - b.id;
	});
	var mapModules = {};
	var mapModulesIdent = {};
	var mapModulesUid = {};
	stats.modules.forEach(function(module, idx) {
		mapModules[module.id] = module;
		mapModulesIdent["$"+module.identifier] = module;
		mapModulesUid[module.uid = idx] = module;
		module.dependencies = [];
	});
	var mapChunks = {};
	stats.chunks = stats.chunks || [];
	stats.chunks.forEach(function(chunk) {
		mapChunks[chunk.id] = chunk;
		chunk.children = [];
	});
	stats.modules.forEach(function(module) {
		module.reasons = module.reasons || [];
		module.reasons.forEach(function(reason) {
			var m = mapModulesIdent["$"+reason.moduleIdentifier];
			if(!m) return;
			reason.moduleUid = m.uid;
			m.dependencies.push({
				type: reason.type,
				moduleId: module.id,
				moduleUid: module.uid,
				module: module.name,
				userRequest: reason.userRequest,
				loc: reason.loc
			});
		});
		module.issuerUid = mapModulesIdent["$"+module.issuer] && mapModulesIdent["$"+module.issuer].uid;
		(function setTimestamp(module) {
			if(typeof module.timestamp === "number") return module.timestamp;
			if(!module.profile) return;
			var factory = module.profile.factory || 0;
			var building = module.profile.building || 0;
			module.time = factory + building;
			if(!module.issuer) return module.timestamp = module.time;
			var issuer = mapModulesIdent["$"+module.issuer];
			if(!issuer) return module.timestamp = NaN;
			setTimestamp(issuer);
			module.timestamp = issuer.timestamp + module.time;
		}(module));
	});
	stats.chunks.forEach(function(chunk) {
		chunk.parents.forEach(function(parent) {
			var c = mapChunks[parent];
			c.children.push(chunk.id);
		});
		chunk.origins.forEach(function(origin) {
			var m = mapModulesIdent["$"+origin.moduleIdentifier];
			if(!m) return;
			origin.moduleUid = m.uid;
		});
	});
	stats.modules.forEach(function(module) {
		module.dependencies.sort(function(a, b) {
			if(!a.loc && !b.loc) return 0;
			if(!a.loc) return 1;
			if(!b.loc) return -1;
			a = a.loc.split(/[:-]/);
			b = b.loc.split(/[:-]/);
			if(+a[0] < +b[0]) return -1;
			if(+a[0] > +b[0]) return 1;
			if(+a[1] < +b[1]) return -1;
			if(+a[1] > +b[1]) return 1;
			return 0;
		});
	});
	var maxLength = 0;
	stats.assets.forEach(function(a) {
		if(a.name.length > maxLength) maxLength = a.name.length;
	});
	stats.assets.forEach(function(a) {
		a.normalizedName = a.name;
		while(a.normalizedName.length < maxLength)
			a.normalizedName = " " + a.normalizedName;
	});
	stats.assets.sort(function(a, b) {
		a = a.normalizedName;
		b = b.normalizedName;
		return a < b ? -1 : 1;
	});

	return {
		stats: stats,
		mapChunks: mapChunks,
		mapModules: mapModules,
		mapModulesUid: mapModulesUid,
		mapModulesIdent: mapModulesIdent
	};
}

function buildGDF(app) {
	let nodes = [];
	let edges = [];

	app.stats.modules.forEach(function(module, idx) {
		var done = {};
		var uniqueReasons = module.reasons.filter(function(reason) {
			var parent = reason.module;
			if(done["$"+parent]) return false;
			done["$"+parent] = true;
			return true;
		});

		var uid = module.uid;
		nodes.push({
			id: "module" + uid,
			uid: uid,
			moduleUid: uid,
			moduleId: module.id,
			module: module,
			size: module.size + 1,
			label: "[" + module.id + "] " + module.name,
			shortLabel: "" + module.id,
			chunks: module.chunks,
		});

		uniqueReasons.forEach(function(reason) {
			var parentIdent = reason.moduleIdentifier;
			var parentModule = app.mapModulesIdent["$"+parentIdent];
			if(!parentModule) return;
			var weight = 1 / uniqueReasons.length / uniqueReasons.length;
			var async = !module.chunks.some(function(chunk) {
				return (function isInChunks(chunks, checked) {
					if(chunks.length === 0) return false;
					if(chunks.indexOf(chunk) >= 0) return true;
					chunks = chunks.filter(function(c) {
						return checked.indexOf(c) < 0;
					});
					if(chunks.length === 0) return false;
					return chunks.some(function(c) {
						return isInChunks(app.mapChunks[c].parents, checked.concat(c));
					});
				}(parentModule.chunks, []));
			});
			edges.push({
				id: "edge" + module.uid + "-" + + parentModule.uid,
				sourceModuleUid: parentModule.uid,
				sourceModule: parentModule,
				source: "module" + parentModule.uid,
				targetModule: module,
				targetModuleUid: module.uid,
				target: "module" + module.uid,
				arrow: "target",
				type: async ? "dashedArrow" : "arrow",
				lineDash: module.chunks.length === 0 ? [2] : [5],
				size: weight,
				weight: async ? weight / 4 : weight
			});
		});
	});

	let nodeDef = "nodedef>name VARCHAR,label VARCHAR,chunks VARCHAR, width DOUBLE\n";
	let nodeDefs = nodes.map((node) => [
			node.id, 
			"'" + node.label + "'", 
			"'" + node.chunks + "'",
			node.size
		].join(","));
	
	let edgeDef = "edgedef>node1 VARCHAR,node2 VARCHAR,directed BOOLEAN,weight DOUBLE\n";
	let edgeDefs = edges.map((edge) => [edge.source, edge.target, true, edge.weight].join(","));

	return nodeDef + 
		nodeDefs.join("\n") + "\n" +
		edgeDef + 
		edgeDefs.join("\n");
}