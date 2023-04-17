/**
 * E-mergo Table Inspector Property Panel definition
 *
 * @param  {Object} util          E-mergo utility functions
 * @param  {Object} docs          E-mergo documentation functions
 * @param  {String} qext          Extension QEXT data
 * @return {Object}               Extension Property Panel definition
 */
define([
	"./util/util",
	"./docs/docs",
	"text!./qs-emergo-table-inspector.qext"
], function( util, docs, qext ) {

	/**
	 * Holds the QEXT data
	 *
	 * @type {Object}
	 */
	var qext = JSON.parse(qext),

	/**
	 * Holds the settings definition of the about sub-panel
	 *
	 * @type {Object}
	 */
	about = {
		label: function() {
			return "About ".concat(qext.title);
		},
		type: "items",
		items: {
			author: {
				label: "This Qlik Sense extension is developed by E-mergo.",
				component: "text"
			},
			version: {
				label: function() {
					return "Version: ".concat(qext.version);
				},
				component: "text"
			},
			description: {
				label: "Please refer to the accompanying documentation page for a detailed description of this extension and its features.",
				component: "text"
			},
			help: {
				label: "Open documentation",
				component: "button",
				action: function( props ) {
					util.requireMarkdownMimetype().finally( function() {
						var readmeFile = window.requirejs.toUrl("extensions/".concat(props.qInfo.qType, "/README.md"));

						require(["text!".concat(readmeFile)], function( readme ) {
							docs.showModal(readme, qext);
						});
					});
				}
			}
		}
	};

	return {
		type: "items",
		component: "accordion",
		items: {
			about: about
		}
	};
});
