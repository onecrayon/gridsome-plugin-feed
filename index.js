const path = require('path')
const url = require('url')
const fs = require('fs-extra')
const Feed = require('feed').Feed
const moment = require('moment')

function urlWithBase (path, base, enforceTrailingSlashes) {
	if (enforceTrailingSlashes && !path.endsWith('/') && !/\.[a-z]{1,4}$/i.test(path)) {
		path = path + '/'
	}
	return new url.URL(path, base).href
}

function convertToSiteUrls (html, baseUrl, enforceTrailingSlashes) {
	// Currently playing it conservative and only modifying things that are explicitly relative URLs
	const relativeRefs = /(href|src)=("|')((?=\.{1,2}\/|\/).+?)\2/gi
	return html.replace(relativeRefs, (_, attribute, quote, relUrl) => {
		return [attribute, '=', quote, urlWithBase(relUrl, baseUrl, enforceTrailingSlashes), quote].join('')
	})
}

function ensureExtension (path, extension) {
	if (path.endsWith(extension)) return path
	if (path.endsWith('/')) {
		return `${path.substring(0, path.length - 1)}${extension}`
	}
	return `${path}${extension}`
}

module.exports = function (api, options) {
	api.afterBuild(({ config }) => {
		if (!config.siteUrl) {
			throw new Error('Feed plugin is missing required global siteUrl config.')
		}
		if (!options.contentTypes || !options.contentTypes.length) {
			throw new Error('Feed plugin is missing required `options.contentTypes` setting.')
		}

		const store = api.store
		const pathPrefix = config.pathPrefix !== '/' ? config.pathPrefix : ''
		const siteUrl = config.siteUrl
		const siteHref = urlWithBase(pathPrefix, siteUrl, options.enforceTrailingSlashes)
		const feedOptions = {
			generator: 'Gridsome Feed Plugin',
			id: siteHref,
			link: siteHref,
			title: config.siteName,
			...options.feedOptions,
			feedLinks: {}
		}
		const rssOutput = options.rss.enabled ? ensureExtension(options.rss.output, '.xml') : null
		const atomOutput = options.atom.enabled ? ensureExtension(options.atom.output, '.atom') : null
		const jsonOutput = options.json.enabled ? ensureExtension(options.json.output, '.json') : null
		if (rssOutput) {
			feedOptions.feedLinks.rss = urlWithBase(pathPrefix + rssOutput, siteUrl)
		}
		if (atomOutput) {
			feedOptions.feedLinks.atom = urlWithBase(pathPrefix + atomOutput, siteUrl)
		}
		if (jsonOutput) {
			feedOptions.feedLinks.json = urlWithBase(pathPrefix + jsonOutput, siteUrl)
		}
		const feed = new Feed(feedOptions)

		let feedItems = []
		for (const contentType of options.contentTypes) {
			const { collection } = store.getContentType(contentType)
			if (!collection.data || !collection.data.length) continue
			// We're mapping to feed items here instead of after sorting in case the data needs
			// to be massaged into the proper format for a feed item (e.g. if the node has a date
			// in a field named something other than `date`). This is slower because we process
			// items that may not get included in the feed, but it's build time, so... ¯\_(ツ)_/¯
			const items = collection.data.filter(options.filterNodes).map(node => {
				const feedItem = options.nodeToFeedItem(node)
				feedItem.id = urlWithBase(pathPrefix + node.path, siteUrl, options.enforceTrailingSlashes)
				feedItem.link = feedItem.id
				return feedItem
			})
			feedItems.push(...items)
		}
		feedItems.sort((a, b) => {
			const aDate = moment(a.date)
			const bDate = moment(b.date)
			if (aDate.isSame(bDate)) return 0
			return aDate.isBefore(bDate) ? 1 : -1
		})
		if (options.maxItems && feedItems.length > options.maxItems) {
			feedItems = feedItems.slice(0, options.maxItems)
		}

		// Process URLs and ensure they are site-relative for any fields that might contain HTML
		for (const item of feedItems) {
			if (options.htmlFields && options.htmlFields.length) {
				for (const field of options.htmlFields) {
					if (!item[field]) continue
					item[field] = convertToSiteUrls(item[field], item.link, options.enforceTrailingSlashes)
				}
			}
			feed.addItem(item)
		}

		if (rssOutput) {
			console.log(`Generate RSS feed at ${rssOutput}`)
			fs.outputFile(path.join(config.outDir, rssOutput), feed.rss2())
		}
		if (atomOutput) {
			console.log(`Generate Atom feed at ${atomOutput}`)
			fs.outputFile(path.join(config.outDir, atomOutput), feed.atom1())
		}
		if (jsonOutput) {
			console.log(`Generate JSON feed at ${jsonOutput}`)
			fs.outputFile(path.join(config.outDir, jsonOutput), feed.json1())
		}
	})
}

module.exports.defaultOptions = () => ({
	contentTypes: [],
	feedOptions: {},
	rss: {
		enabled: true,
		output: '/feed.xml'
	},
	atom: {
		enabled: false,
		output: '/feed.atom'
	},
	json: {
		enabled: false,
		output: '/feed.json'
	},
	maxItems: 25,
	htmlFields: ['description', 'content'],
	enforceTrailingSlashes: false,
	filterNodes: node => true,
	nodeToFeedItem: node => ({
		title: node.title,
		date: node.date || node.fields.date,
		content: node.content
	})
})
