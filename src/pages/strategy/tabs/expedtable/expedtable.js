(function(){
	"use strict";
	/*
	  data format for expedition table:
	  - for income modifier:

		  - standard modifier:

		  { type: "normal",
			gs: true / false,
			daihatsu: 0 ~ 4
		  }

		  - "gs" indicates whether great success is intended
		  - whoever saves the data is responsible for its consistency
				if say daihatsu value turns out to be 5, that's not my fault

		  - custom modifier:

		  { type: "custom",
			value: a number, from 1.0 to perhaps 2.0 (meaning 100% ~ 200%)
		  }

			  - great success should be taken into account by custom modifier.
				which means if user intends to carry 4 daihatsus and ensure GS,
				this value needs to be 1.8 (1.5 * 1.2)
			  - the design decision is made in this way so that if future update
				adds some mechanism that affect GS modifier, we will still be flexible.

	  - for cost:
		  - cost deals with the problem that user might carry extra ships for
			a higher GS rate.

		  - standard:
		  { type: "costmodel",

			wildcard: "DD" / "SS" / false,
			count: 0 ~ 6 (but make it only possible to select 4~6 from UI)
		  }

		  - custom:

		  { type: "custom",
			fuel: integer (non-negative),
			ammo: integer (non-negative)
		  }

	 */

	// some PureScript librarys, imported locally.
	let ExpedInfo = PS["KanColle.Expedition.New.Info"];
	let ExpedSType = PS["KanColle.Expedition.New.SType"];
	let ExpedCostModel = PS["KanColle.Expedition.New.CostModel"];
	let ExpedMinCompo = PS["KanColle.Expedition.New.MinCompo"];
	let Maybe = PS["Data.Maybe"];
	let PartialUnsafe = PS["Partial.Unsafe"];
	let fromJust = PartialUnsafe.unsafePartial(Maybe.fromJust);

	function getRandomInt(min,max) {
		min = Math.ceil(min);
		max = Math.floor(max);
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	let coinFlip = () => Math.random() > 0.5;

	function genModStandard() {
		return {
			type: "normal",
			gs: coinFlip(),
			daihatsu: getRandomInt(0,4)
		};
	}

	function genModCustom() {
		return {
			type: "custom",
			value: 1.0 + Math.random() * 0.8
		};
	}

	function genCostNormal() {
		let retVal = {
			type: "costmodel",
			wildcard: [false,"DD","SS"][getRandomInt(0,2)],
			count: getRandomInt(4,6)
		};
		if (retVal.wildcard === false)
			retVal.count = 0;
		return retVal;
	}

	function genCostCustom() {
		return {
			type: "custom",
			fuel: getRandomInt(10,500),
			ammo: getRandomInt(10,500)
		};
	}

	function generateRandomConfig() {
		let config = {};
		for (let i = 1; i <= 40; ++i) {
			config[i] = {
				modifier: (coinFlip()) ? genModStandard() : genModCustom(),
				cost: (coinFlip()) ? genCostNormal() : genCostCustom()
			};
		}

		return config;
	}

	function mergeExpedCost(arr) {
		return arr.reduce( function(acc, cur) {
			return { ammo: acc.ammo + cur.ammo,
					 fuel: acc.fuel + cur.fuel };
		}, {ammo: 0, fuel: 0});
	}

	function enumFromTo(from,to,step=1) {
		var arr = [];
		for (let i=from; i<=to; i+=step)
			arr.push(i);
		return arr;
	}

	function normalModifierToNumber(modConfig) {
		console.assert( modConfig.type === "normal" );
		return (modConfig.gs ? 1.5 : 1.0)*(1.0+0.05*modConfig.daihatsu);
	}

	function prettyFloat(n,precision=2,positiveSign=false) {
		let fixed = n.toFixed(precision);
		let str = String(n);
		// we want "0" to be "+0"
		let pre = (positiveSign && n >= 0) ? "+" : "";
		return pre + ((str.length <= fixed.length) ? str : fixed);
	}

	function saturate(v,min,max) {
		return Math.max(Math.min(v,max),min);
	}

	function costConfigToActualCost(costConfig,eId) {
		console.assert( costConfig.type === "costmodel" ||
						costConfig.type === "custom" );
		if (costConfig.type === "costmodel") {
			let minCompo = ExpedMinCompo.getMinimumComposition(eId);
			let stype =
				/* when wildcard is not used, count must be 0 so
				   we have nothing to fill in, here "DD" is just
				   a placeholder that never got used.
				*/
				costConfig.wildcard === false ? new ExpedSType.DD()
				: costConfig.wildcard === "DD" ? new ExpedSType.DD()
				: costConfig.wildcard === "SS" ? new ExpedSType.SSLike()
				: "Invalid wildcard in costConfig";

			if (typeof stype === "string")
				throw stype;
			let actualCompo =
				ExpedMinCompo.concretizeComposition(costConfig.count)(stype)(minCompo);
			let info = ExpedInfo.getInformation(eId);
			let costModel = ExpedCostModel.normalCostModel;
			let fleetMaxCost = ExpedCostModel.calcFleetMaxCost(costModel)(actualCompo);
			if (! Maybe.isJust(fleetMaxCost)) {
				throw "CostModel fails to compute a cost for current fleet composition";
			} else {
				fleetMaxCost = fromJust(fleetMaxCost);
			}
			let fleetActualCost = fleetMaxCost.map( function(x) {
				return {
					fuel: Math.floor( info.fuelCostPercent * x.fuel ),
					ammo: Math.floor( info.ammoCostPercent * x.ammo )
				};
			});
			return mergeExpedCost( fleetActualCost );
		} else {
			return {
				fuel: costConfig.fuel,
				ammo: costConfig.ammo };
		}
	}

	function generateCostGrouping() {
		let allExpeds = enumFromTo(1,40).map( function(x) {
			let info = ExpedInfo.getInformation(x);
			return { ammo: Math.round( info.ammoCostPercent * 100),
					 ammoP: info.ammoCostPercent,
					 fuel: Math.round( info.fuelCostPercent * 100),
					 fuelP: info.fuelCostPercent,
					 id: x };
		});
		allExpeds.sort( function(a,b) {
			// key 1: group by total consumption
			let aTotal = a.ammo + a.fuel;
			let bTotal = b.ammo + b.fuel;
			if (aTotal != bTotal)
				return aTotal - bTotal;

			// key 2: group by either (begin with fuel because all expeds
			// is sure to spend some)
			if (a.fuel != b.fuel)
				return a.fuel - b.fuel;
			if (a.ammo != b.ammo)
				return a.ammo - b.ammo;

			// finally tie break by exped id
			return a.id - b.id;
		});

		let currentGrp = false;
		let grouped = [];

		function eq(a,b) {
			return (a.fuel == b.fuel) && (a.ammo == b.ammo);
		}

		while (allExpeds.length > 0) {
			let curExped = allExpeds.shift();
			if (currentGrp === false) {
				currentGrp = [curExped];
			} else if (eq(currentGrp[0], curExped)) {
				currentGrp.push( curExped );
			} else {
				grouped.push( currentGrp );
				currentGrp = [curExped];
			}
		}

		if (currentGrp !== false) {
			grouped.push( currentGrp );
			currentGrp = false;
		}

		grouped = grouped.map( function(x) {
			return { ammo: x[0].ammo,
					 fuel: x[0].fuel,
					 expeds: x.map( y => y.id ) };
		});

		grouped.sort( function(a,b) {
			if (b.expeds.length !== a.expeds.length)
				return b.expeds.length- a.expeds.length;

			let aTotal = a.ammo + a.fuel;
			let bTotal = b.ammo + b.fuel;
			return bTotal - aTotal;
		});
		console.log(JSON.stringify(grouped));
	}

	// generated from generateCostGrouping()
	let expedCostGrouping = [
		{ammo:0,fuel:50,expeds:[2,4,5,7,9,11,12,14,31]},
		{ammo:80,fuel:80,expeds:[23,26,27,28,35,36,37,38]},
		{ammo:40,fuel:50,expeds:[13,15,16,19,20]},
		{ammo:70,fuel:80,expeds:[21,22,40]},
		{ammo:80,fuel:50,expeds:[25,33,34]},
		{ammo:20,fuel:50,expeds:[8,18]},{ammo:20,fuel:30,expeds:[3,6]},
		{ammo:0,fuel:30,expeds:[1,10]},{ammo:90,fuel:90,expeds:[39]},
		{ammo:70,fuel:90,expeds:[30]},{ammo:60,fuel:90,expeds:[24]},
		{ammo:40,fuel:90,expeds:[29]},{ammo:30,fuel:90,expeds:[32]},
		{ammo:40,fuel:30,expeds:[17]}];

	function eqModConfig(a,b) {
		return a.type === b.type &&
			(a.type === "normal"
			 ? (a.gs === b.gs && a.daihatsu === b.daihatsu)
			 : a.value === b.value);
	}

	function eqCostConfig(a,b) {
		return a.type === b.type &&
			(a.type === "costmodel"
			 ? (a.count === b.count && a.wildcard === b.wildcard)
			 : (a.fuel === b.fuel && a.ammo === b.ammo));
	}

	function eqConfig(a,b) {
		return eqModConfig(a.modifier, b.modifier) &&
			eqCostConfig(a.cost, b.cost);
	}

	/*
	  TODO:

	  - sorter: by exped id, time, fuel, ammo, etc.

	  - don't do reverse sort by clicking one repeatly, let's just put a "reverse" button

	  - disabled whenever any of the expeditions are still under editing

	  - hotzone coloring (based on number of completed expedtion)

	  - generate config using data from exped table of devtools

	  - localStorage

	  - re-format data format

	 */

	KC3StrategyTabs.expedtable = new KC3StrategyTab("expedtable");

	KC3StrategyTabs.expedtable.definition = {
		tabSelf: KC3StrategyTabs.expedtable,

		// TODO: will be replaced by localStorage
		expedConfig: false,

		/* INIT: mandatory
		Prepares initial static data needed.
		---------------------------------*/
		init: function() {
		},

		/* RELOAD: optional
		Loads latest player or game data if needed.
		---------------------------------*/
		reload: function() {
		},

		setupCostModelSection: function() {
			let contentRoot = $(".tab_expedtable #cost_model_content_root");
			let tableRoot = $("table", contentRoot);
			let jqPreset = $("select.cost_preset", contentRoot);
			let presetFlag = false;

			let calcCostModel = (stypeInstance, num) =>
				ExpedCostModel.normalCostModel(stypeInstance)(num);

			// setup slider controls
			let sliderSettings = {
				ticks: enumFromTo(0,100,10),
				step: 10,
				// default of both fuel and ammo are 80%
				value: 80,
				tooltip: "hide"
			};

			let viewFuelPercent = $(".control_row.fuel .val");
			let viewAmmoPercent = $(".control_row.ammo .val");
			let tableBody = $("tbody",tableRoot);
			function updateCostModelTable( which, newValue ){
				console.assert( which === "fuel" || which === "ammo" );
				( which === "fuel" ? viewFuelPercent
				  : which === "ammo" ? viewAmmoPercent
				  : undefined ).text( newValue + "%" );

				let actualPercent = (newValue + 0.0) / 100.0;
				$(".cost_cell", tableBody).each( function() {
					let jq = $(this);
					let maxCostArr = jq.data("max-cost-arr");
					let actualCost = maxCostArr
						.map( x => Math.floor( x[which] * actualPercent ) )
						.reduce( (x,y) => x+y, 0);
					$("." + which, this).text( actualCost );
				});
			}

			let sliderFuel = $("input#cost_model_fuel")
				.slider(sliderSettings)
				.on("change", function(e) {
					updateCostModelTable( "fuel", e.value.newValue );
					if (!presetFlag)
						jqPreset.val("title");
				});
			let sliderAmmo = $("input#cost_model_ammo")
				.slider(sliderSettings)
				.on("change", function(e) {
					updateCostModelTable( "ammo", e.value.newValue );
					if (!presetFlag)
						jqPreset.val("title");
				});

			// setup table
			let stypeTexts = [
				"DD", "CL", "CVLike", "SSLike",
				"CA", "BBV", "AS", "CT", "AV"];

			stypeTexts.map( function(stype) {
				let tblRow = $("<tr>");
				let stypeHead = $("<th>");

				if (stype === "CVLike") {
					stypeHead
						.text("CV(*)")
						.attr("title", "CV / CVL / AV / CVB");
				} else if (stype === "SSLike") {
					stypeHead
						.text( "SS(*)" )
						.attr("title", "SS / SSV");
				} else {
					stypeHead.text( stype );
				}

				tblRow.append( stypeHead );
				for (let i=1; i<=6; ++i) {
					let stypeInst = ExpedSType[stype].value;
					let costResult = calcCostModel(stypeInst, i);
					let cell;

					if (Maybe.isJust( costResult )) {
						cell = $(".tab_expedtable .factory .cost_cell").clone();
						let costArr = fromJust(costResult);
						cell.data( "max-cost-arr", costArr );
					} else {
						cell = $(".tab_expedtable .factory .cost_cell_na").clone();
					}
					tblRow.append( $("<td />").append(cell) );
				}

				tableBody.append( tblRow );
			});

			// sync controls with default value
			updateCostModelTable("fuel", sliderFuel.slider("getValue"));
			updateCostModelTable("ammo", sliderAmmo.slider("getValue"));

			expedCostGrouping.map( function(x,i) {
				let desc = "" + x.fuel + "% Fuel, " + x.ammo + "% Ammo,";
				desc += " " +
					(x.expeds.length > 1 ? "Expeditions" : "Expedition")+ ": " +
					x.expeds.join(",");
				jqPreset.append( $("<option />", {value: i}).text(desc) );
			});

			jqPreset.change( function() {
				if (this.value === "title")
					return;
				presetFlag = true;
				let cost = expedCostGrouping[this.value];
				sliderFuel.slider("setValue", cost.fuel);
				sliderAmmo.slider("setValue", cost.ammo);
				updateCostModelTable("fuel", cost.fuel);
				updateCostModelTable("ammo", cost.ammo);
				presetFlag = false;
			});
		},

		/* EXECUTE: mandatory
		Places data onto the interface from scratch.
		---------------------------------*/
		execute: function() {
			let self = this;
			// a random-generated configuration for debugging purpose
			var expedConfig = generateRandomConfig();
			self.expedConfig = expedConfig;
			var factory = $(".tab_expedtable .factory");
			var expedTableRoot = $("#exped_table_content_root");
			let allExpeds = enumFromTo(1,40);

			// view controls need to be set up before any exped rows
			self.setupViewControls();

			function makeWinItem( jqObj, winItemArr ) {
				var itemId = winItemArr[0];
				var idToItem = {
					1: "bucket",
					2: "ibuild",
					3: "devmat",
					10: "box1",
					11: "box2",
					12: "box3"
				};
				if (itemId !== 0) {
					jqObj
						.append($(
							"<img>",
							{src: "../../assets/img/client/"+idToItem[itemId]+".png"}))
						.append("x" + winItemArr[1]);
				} else {
					jqObj.text( "-" );
				}
			}

			allExpeds.forEach( function(eId) {
				var expedRow = $(".exped_row", factory).clone();
				expedRow.data( "id", eId );
				var resourceInfo = ExpedInfo.getInformation( eId ).resource;
				var masterInfo = KC3Master._raw.mission[eId];
				var config = expedConfig[eId];

				// store some basic info for later calculation.
				expedRow.data("info",
					$.extend( {}, resourceInfo, { time: masterInfo.api_time }));

				$(".info_col.id", expedRow).text( eId );
				$(".info_col.time", expedRow).text( String( 60 * masterInfo.api_time ).toHHMMSS() );

				makeWinItem( $(".info_col.item1", expedRow), masterInfo.api_win_item1 );
				makeWinItem( $(".info_col.item2", expedRow), masterInfo.api_win_item2 );

				self.setupExpedView(expedRow, config, eId);
				// a local to this UI setup function, used as an internal state
				// to indicate whether we need to re-update config part of UI.
				let configSynced = false;

				$(".edit_btn", expedRow).on("click", function() {
					expedRow.toggleClass("active");
					let expanding = expedRow.hasClass("active");
					let configRoot = $(".exped_config", expedRow);
					$(this).text( expanding ? "▼" : "◀");
					if (expanding) {
						// when expanding, we need to put configs on UI.

						// we prevent reseting UI every time
						// if nothing has been changed,
						// local variable "configSynced" is used as an indicator
						// to tell whether we need to update the config part of UI

						// intentionally shadowing "config",
						// and now we have the latest "config".
						let config = expedConfig[eId];
						if (configSynced) {
							// console.log( "config UI is already synced, skipping UI update" );
						} else {
							self.setupExpedConfig(configRoot, config, eId);
							configSynced = true;
						}

						// disable all view / sort controls when start editing
						$(".exped_control_row button", expedTableRoot).prop("disabled", true);
					} else {
						// collapsing
						// construct new config from UI.
						let newConfig = self.getExpedConfig(configRoot, eId);
						if (eqConfig(expedConfig[eId], newConfig)) {
							// console.log( "config is not changed, skipping UI update." );
						} else {
							expedConfig[eId] = newConfig;
							self.setupExpedView(expedRow, newConfig, eId);
							configSynced = false;
						}

						// enable all view / sort controls
						// if none of the rows are still under editing.
						if ($(".exped_row.active", expedTableRoot).length === 0) {
							$(".exped_control_row button", expedTableRoot).prop("disabled", false);
						}
					}
				});

				// setup Income Modifier
				let jqIMRoot = $(".exped_config .modifier .content", expedRow);
				$("input[type=radio]", jqIMRoot)
					.change( function() {
						let isModNormal = this.value === "normal";
						$(".group.mod_normal *", jqIMRoot)
							.filter(":input").prop("disabled", !isModNormal);
						$(".group.mod_custom *", jqIMRoot)
							.filter(":input").prop("disabled", isModNormal);
					})
					.each( function() {
						$(this).attr("name",  "modifier-" + eId );
					});

				// setup Resupply Cost
				let jqCRoot = $(".exped_config .cost .content", expedRow);
				$("input[type=radio]", jqCRoot)
					.change( function() {
						let isCostNormal = this.value === "normal";
						$(".group.cost_normal *", jqCRoot)
							.filter(":input").prop("disabled", !isCostNormal);
						$(".group.cost_custom *", jqCRoot)
							.filter(":input").prop("disabled", isCostNormal);
					})
					.each( function() {
						$(this).attr("name",  "cost-" + eId );
					});

				expedTableRoot.append( expedRow );
			});

			self.setupSorters();
			self.setupCostModelSection();
		},

		setupSorters: function() {
			// Sorter behavior: (TODO)
			// - mutually exclusive, with expedition id being default
			// - any config change invalidates sorting method,
			//   so we will clear all sorter active states, unless the already
			//   selected one is "sort by id" or "sort by time"
			// - won't redo sorting after user has changed some config,
			//   by doing so we keep every exped row in its before-editing place
			//   so it can be conveniently edited again.
		},

		setupViewControls: function() {
			let self = this;
			let expedTableRoot = $("#exped_table_content_root");

			$(".view_control .force_general", expedTableRoot).click( function() {
				$(this).toggleClass("active");
				self.refreshAllExpedRows();
			});

			let jqDenomControls = $(".view_control .denom_control button");
			jqDenomControls.click( function() {
				let thisMode = $(this).data("mode");
				let alreadyActive = $(this).hasClass("active");
				jqDenomControls.each( function() {
					let thatMode = $(this).data("mode");
					$(this).toggleClass("active", thisMode === thatMode );
				});
				if (alreadyActive)
					return;
				self.refreshAllExpedRows();
			});
			let jqIncomeControls = $(".view_control .income_control button");
			jqIncomeControls.click( function() {
				let thisMode = $(this).data("mode");
				let alreadyActive = $(this).hasClass("active");
				jqIncomeControls.each( function() {
					let thatMode = $(this).data("mode");
					$(this).toggleClass("active", thisMode === thatMode );
				});
				if (alreadyActive)
					return;
				self.refreshAllExpedRows();
			});
			// setup view strategy: total, basic income.
			// we don't have to save state internally, one just need to find the active
			// button from page itself.
			jqDenomControls.filter("[data-mode=total]").click();
			jqIncomeControls.filter("[data-mode=basic]").click();
		},

		refreshAllExpedRows: function() {
			let self = this;
			let expedTableRoot = $("#exped_table_content_root");
			$(".exped_row", expedTableRoot).each( function() {
				let jq = $(this);
				let eId = parseInt(jq.data("id"), 10);
				let config = self.expedConfig[eId];
				self.setupExpedView.call(self, jq, config, eId);
			});
		},

		// the "setup" does not include UI initialization, just those that can be changed due to
		// the change of a config.
		setupExpedView: function(jqViewRoot, config, eId) {
			let expedTableRoot = $("#exped_table_content_root");

			let forceGeneral =
				$(".view_control .force_general", expedTableRoot).hasClass("active");
			let modViewByGeneral = forceGeneral ||
				config.modifier.type !== "normal";
			$(".modifier .view.view_general", jqViewRoot).toggle( modViewByGeneral );
			$(".modifier .view.view_normal", jqViewRoot).toggle( !modViewByGeneral );

			let costViewByGeneral = forceGeneral ||
				config.cost.type !== "costmodel" ||
				(config.cost.type === "costmodel" &&
				 config.cost.wildcard === false);
			$(".cost .view.view_general", jqViewRoot).toggle( costViewByGeneral );
			$(".cost .view.view_normal", jqViewRoot).toggle( !costViewByGeneral );

			let generalModifier = config.modifier.type === "normal"
				? normalModifierToNumber(config.modifier)
				: config.modifier.value;

			let gainPercent = (generalModifier-1.0)*100;
			$(".modifier .view.view_general", jqViewRoot).text(
				prettyFloat(gainPercent,2,true) + "%");

			if (config.modifier.type === "normal") {
				$(".modifier .view.view_normal img.gs", jqViewRoot).attr(
					"src", config.modifier.gs
						? "../../assets/img/ui/btn-gs.png"
						: "../../assets/img/ui/btn-xgs.png" );
				$(".modifier .view.view_normal .dht_times", jqViewRoot).text(
					"x" + config.modifier.daihatsu);
			}

			let computedCost = costConfigToActualCost(config.cost,eId);
			$(".cost .view.view_general .fuel", jqViewRoot).text(String(-computedCost.fuel));
			$(".cost .view.view_general .ammo", jqViewRoot).text(String(-computedCost.ammo));
			if (!costViewByGeneral) {
				$(".cost .view.view_normal .limit", jqViewRoot)
					.text("≥" + config.cost.count);
				$(".cost .view.view_normal .wildcard", jqViewRoot)
					.text("(*=" + config.cost.wildcard + ")");
			}

			// work out resource info to show last,
			// because by now we have "computedCost" and "generalModifier" available.
			let denomMode =
				$(".view_control .denom_control button.active",expedTableRoot).data("mode");
			let incomeMode =
				$(".view_control .income_control button.active",expedTableRoot).data("mode");
			console.assert( ["total","hourly"].indexOf( denomMode ) !== -1);
			console.assert( ["gross","net","basic"].indexOf( incomeMode ) !== -1);

			let expedInfo = jqViewRoot.data("info");
			function processResource(basicValue, resourceName) {
				let grossValue = Math.floor(basicValue * generalModifier);
				let netValue = typeof computedCost[resourceName] !== "undefined"
					? grossValue - computedCost[resourceName]
					: grossValue;
				let subTotal = incomeMode === "basic" ? basicValue
					: incomeMode === "gross" ? grossValue : netValue;
				return denomMode === "total" ? subTotal
					: (0.0 + subTotal) / expedInfo.time;
			}
			// for recording final resource value
			let actual = {};
			["fuel", "ammo", "steel", "bauxite"].forEach( function(name) {
				actual[name] = processResource(expedInfo[name], name);
				let resourceText = denomMode === "total" ? String(actual[name])
					: prettyFloat(actual[name]);
				$(".info_col." + name, jqViewRoot).text( resourceText );
			});
			jqViewRoot.data("actual", actual);

		},

		// the "setup" does not include UI initialization, just those that can be changed due to
		// the change of a config.
		setupExpedConfig: function(jqConfigRoot, config, eId) {
			let jqIMRoot = $(".modifier .content", jqConfigRoot);

			$("input[type=radio]", jqIMRoot).filter("[value=" + config.modifier.type + "]")
				.prop("checked", true).change();

			// we try to fill in as much as info as we can for the other option.
			if (config.modifier.type === "normal") {
				// normal
				$("input[type=checkbox][name=gs]",jqIMRoot)
					.prop("checked", config.modifier.gs);
				$("select.dht",jqIMRoot).val(config.modifier.daihatsu);

				$("input.custom_val[type=text]",jqIMRoot)
					.val( prettyFloat(normalModifierToNumber(config.modifier)) );
			} else {
				// custom
				$("input.custom_val[type=text]",jqIMRoot)
					.val( config.modifier.value );

				// now let's guess what could be the corresponding setting for normal config
				let guessedGS = config.modifier.value >= 1.5;
				let valBeforeGS = guessedGS
					? config.modifier.value / 1.5
					: config.modifier.value;
				let guessedDHT = Math.floor((valBeforeGS - 1)/0.05);
				guessedDHT = saturate(guessedDHT,0,4);
				$("input[type=checkbox][name=gs]",jqIMRoot)
					.prop("checked", guessedGS);
				$("select.dht",jqIMRoot).val(guessedDHT);
			}

			// setup Resupply Cost
			let jqCRoot = $(".cost .content", jqConfigRoot);

			$("input[type=radio]", jqCRoot).filter(
				"[value=" + (config.cost.type === "costmodel"
							 ? "normal" : "custom") + "]")
				.prop("checked", true).change();

			if (config.cost.type === "costmodel") {
				// normal
				$("select.wildcard",jqCRoot).val(
					config.cost.wildcard === false
						? "None" : config.cost.wildcard);
				$("select.count",jqCRoot).val( config.cost.count );

				let actualCost = costConfigToActualCost( config.cost, eId );
				$("input[type=text][name=fuel]", jqCRoot).val( actualCost.fuel );
				$("input[type=text][name=ammo]", jqCRoot).val( actualCost.ammo );
			} else {
				// custom
				$("input[type=text][name=fuel]", jqCRoot).val( config.cost.fuel );
				$("input[type=text][name=ammo]", jqCRoot).val( config.cost.ammo );
				// it's hard to guess info from cost.
				// so let's just set everything to default:
				// - if user requires great success, we set wildcard to DD with 6 ships.
				// - otherwise, None with no ship.
				let guessedGS = (config.modifier.type === "normal"
								 ? config.modifier.gs
								 : config.modifier.value >= 1.5);
				let guessedWildcard = guessedGS ? "DD" : "None";
				let guessedCount = guessedGS ? 6 : 0;
				$("select.wildcard",jqCRoot).val( guessedWildcard );
				$("select.count",jqCRoot).val( guessedCount );
			}
		},

		getExpedConfig: function(jqConfigRoot, eId) {
			let modifier = {};
			let jqIMRoot = $(".modifier .content", jqConfigRoot);

			modifier.type = $("input[type=radio]:checked", jqIMRoot).val();
			console.assert( modifier.type === "normal" ||
							modifier.type === "custom" );

			if (modifier.type === "normal") {
				modifier.gs = $("input[type=checkbox][name=gs]",jqIMRoot).prop("checked");
				modifier.daihatsu = parseInt(
					$("select.dht",jqIMRoot).val(), 10);
			} else {
				modifier.value = $("input.custom_val[type=text]",jqIMRoot).val();
				// parse value, and then limit its range to 0.5 ~ 4.0.
				// a more practical range would be 1.0 ~ 1.95(=1.5*1.30)
				// but let's assume user knows what he is done and be more permissive.
				modifier.value = saturate(parseFloat( modifier.value ) || 1.0,
										  0.5, 4.0);

				// update user input to prevent UI out-of-sync due to normalization
				$("input.custom_val[type=text]",jqIMRoot).val( modifier.value );
			}

			let cost = {};
			let jqCRoot = $(".cost .content", jqConfigRoot);

			cost.type = $("input[type=radio]:checked", jqCRoot).val();
			console.assert( cost.type === "normal" ||
							cost.type === "custom" );
			if (cost.type === "normal") {
				cost.type = "costmodel";
				cost.wildcard = $("select.wildcard",jqCRoot).val();
				console.assert( ["None", "SS", "DD"].indexOf(cost.wildcard) !== -1);
				if (cost.wildcard === "None") {
					cost.wildcard = false;
					// force count to be 0, no matter what user sets.
					cost.count = 0;
				} else {
					cost.count = $("select.count",jqCRoot).val();
					cost.count = parseInt(cost.count, 10);
					console.assert( typeof cost.count === "number" &&
									cost.count >= 0 && cost.count <= 6);
				}
			} else {
				// custom
				let normalize = (raw) => {
					raw = parseInt(raw,10) || 0;
					// in case user decides to put down a negative value
					raw = Math.abs(raw);
					// limit cost range to 0~1000, sounds like a permissive range
					return saturate(raw,0,1000);
				};

				cost.fuel = $("input[type=text][name=fuel]", jqCRoot).val();
				cost.fuel = normalize(cost.fuel);

				cost.ammo = $("input[type=text][name=ammo]", jqCRoot).val();
				cost.ammo = normalize(cost.ammo);

				// update user input to prevent UI out-of-sync due to normalization
				$("input[type=text][name=fuel]", jqCRoot).val( cost.fuel );
				$("input[type=text][name=ammo]", jqCRoot).val( cost.ammo );
			}

			return {modifier, cost};
		},

		/* UPDATE: optional
		Partially update elements of the interface,
			possibly without clearing all contents first.
		Be careful! Do not only update new data,
			but also handle the old states (do cleanup).
		Return `false` if updating all needed,
			EXECUTE will be invoked instead.
		---------------------------------*/
		update: function(pageParams) {
			// Use `pageParams` for latest page hash values,
			// KC3StrategyTabs.pageParams keeps the old values for states tracking

			// Returning `true` means updating has been handled.
			return false;
		}
	};
})();
