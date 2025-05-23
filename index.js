import 'dotenv/config'
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import rl from 'deadline';
import lineByLine from 'n-readlines';

const headers = {
		'Content-Type': 'application/json',	
		'Authorization': 'Basic ' + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_TOKEN}`).toString('base64'), // Base64 encoded "username:password"
};

const exportFolder = './exported/';

if (!fs.existsSync(exportFolder)) {
	fs.mkdirSync(exportFolder);
	console.log(`Folder "${exportFolder}" created successfully.`);
}
if (!fs.existsSync(exportFolder + 'attachments/')) {
    fs.mkdirSync(exportFolder + 'attachments/');
    console.log(`Folder "${exportFolder}attachments" created successfully.`);
}


const requestWithRateLimit = async (config) => {
	config.validateStatus = status => status === 200 || status === 429
	const response = await axios(config);
	if (response.status === 429) {
		const secondsToWait = Number(response.headers["retry-after"])
		await new Promise(resolve => setTimeout(resolve, (secondsToWait + 1) * 1000))
		return requestWithRateLimit(config)
	}
	return response;
}

/**
 * Retrieves tickets
 * @async
 * @param {boolean} cursor - Cursor for pagination.
 * @returns {Promise<boolean>} Promise indicating success of operation.
 */
const getTickets = async (cursor = false) => {

	var config = {
		method: 'GET',
		url: process.env.ZENDESK_API + 'incremental/tickets/cursor',
		headers: headers,
	    params: {
	    	'cursor': (cursor) ? cursor : '',
	    	'start_time': '0',
	    },
	};

	return new Promise((resolve, reject) => {

		requestWithRateLimit(config).then(function (response) {

			//console.log(JSON.stringify(response.data.tickets));
			for (const [key, value] of Object.entries(response.data.tickets)) {
				//console.log(`${key}: ${value}`);
				delete value.url;

				fs.writeFileSync(exportFolder + 'tickets.json', JSON.stringify(value) + "\n", { flag: "a+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}
			console.log('end_of_stream:', response.data.end_of_stream);

			//if (cursor) { console.log('stop!'); return false; }

			if (false === response.data.end_of_stream) {
				console.log('not the end, cursor: ' + response.data.after_cursor);
				resolve(getTickets(response.data.after_cursor));
			} else {
				resolve(true);
			}

		}).catch(function (error) {
			console.log(error);
		});

	});
}


/**
 * Retrieves comments for a ticket
 * @async
 * @param {number} id - Ticket ID.
 * @param {boolean} next_page - Next page of comments.
 * @param {Array} comments - Array to store comments.
 * @returns {Promise<void>} Promise indicating success of operation.
 */
const getTicketComments = async function(id, next_page = false, comments = [], errors_count = 0) {

	return new Promise((resolve, reject) => {

		console.log('getTicketComments');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'tickets/' + id + '/comments',
			headers: headers,
		    params: {
	    		//'include': 'users',
	    		'include_inline_images': true,
	    		//'sort_order': '',
		    },
		};

		requestWithRateLimit(config).then(async function (response) {

			comments = [...comments, ...response.data.comments];

			if (null !== response.data.next_page) { // has more than one page
				console.log('id:', id);
				console.log('error response.data.next_page:', response.data.next_page);

				await getTicketComments(id, response.data.next_page, comments);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'comments.json', id + "\n" + JSON.stringify(comments) + "\n", { flag: "a+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			if (10 < errors_count) {
				console.log('skipping because of too many errors', id)
				logError(`Skipping getTicketComments because of too many errors: ${JSON.stringify([id, next_page, comments, errors_count])}`)
				resolve();
				return;
			}


			if ('ERR_BAD_RESPONSE' === error.code) {
				console.log('ERR_BAD_RESPONSE received, retring...', id, next_page, comments, errors_count);
				resolve(getTicketComments(id, next_page, comments, ++errors_count))
			} else if ('ERR_BAD_REQUEST' === error.code && 404 === error.response.status) {
				console.log('Looks like ticket was removed, skipping it', id)
				logError(`Looks like ticket was removed, skipping it ${id}`);
				resolve();
			} else {
				console.log('!!!!Error code:', error.code);
				console.log(error);
				reject(); // ::TODO:: if 500 error or something just skipping and continuing
			}
		});

	});
}


/**
 * Logs an error message to a file.
 * @param {string} message - The error message to log.
 */
const logError = (message) => {
	fs.writeFileSync(exportFolder + 'errors.txt', message + "\n", { flag: "a+" }, (err) => {
		if (err) throw err;
	});
}


/**
 * Retrieves comments for all tickets. Can be restarted and will automatically start where it finished
 * @async
 * @returns {Promise<void>} Promise indicating success of operation.
 */
const getAllTicketComments = async function() {

	const saved_tickets_ids = getAllSavedTicketComments();
	const liner = new lineByLine(exportFolder + 'tickets.json');

	let line;
	let lineNumber = 0;
	while (line = liner.next()) {
	    //console.log('Line ' + lineNumber + ': ' + line);

	    let ticket = JSON.parse(line);
    	console.log(ticket.id);

    	if (!saved_tickets_ids.includes(ticket.id)) {
    		await getTicketComments(ticket.id);
    	} else {
    		console.log('skip');
    	}

	    lineNumber++;
	}

	console.log('end of line reached');
}


/**
 * Retrieves IDs of all saved ticket comments from the exported file.
 * @returns {Array<number>} Array of ticket IDs.
 */
const getAllSavedTicketComments = function() {
	let saved_tickets_ids = [];

	if (!fs.existsSync(exportFolder + 'comments.json')) {
		return saved_tickets_ids;
	}

	const liner = new lineByLine(exportFolder + 'comments.json');
	let line;
	let lineNumber = 0;
	while (line = liner.next()) {
	    //console.log('Line ' + lineNumber + ': ' + line);
		if (0 == lineNumber%2) {
			//console.log(''+  line);
			saved_tickets_ids.push(parseInt(line));
		}
	    lineNumber++;
	}

	console.log('getAllSavedTicketComments', saved_tickets_ids);
	return saved_tickets_ids;
}


/**
 * Retrieves users from Zendesk API.
 * @param {boolean} cursor - Cursor for pagination.
 * @returns {Promise<boolean>} Promise indicating success of operation.
 */
const getUsers = function(cursor = false) {

	var config = {
		method: 'GET',
		url: process.env.ZENDESK_API + 'incremental/users/cursor',
		headers: headers,
	    params: {
	    	'cursor': (cursor) ? cursor : '',
	    	'start_time': '0',
	    },
	};


	return new Promise((resolve, reject) => {

		requestWithRateLimit(config).then(function (response) {

			//console.log(JSON.stringify(response.data.tickets));
			for (const [key, value] of Object.entries(response.data.users)) {
				//console.log(`${key}: ${value}`);
				delete value.url;

				fs.writeFileSync(exportFolder + 'users.json', JSON.stringify(value) + "\n", { flag: "a+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});

			}

			console.log('end_of_stream:', response.data.end_of_stream);
			//if (cursor) { console.log('stop!'); return false; }

			if (false === response.data.end_of_stream) {
				console.log('not the end, cursor: ' + response.data.after_cursor);
				resolve(getUsers(response.data.after_cursor));
			} else {
				resolve(true);
			}

		}).catch(function (error) {
			console.log(error);
			reject(error);
		});

	});
}


/**
 * Downloads attachments from Zendesk comments.
 * @async
 * @param {boolean} cursor - Cursor for pagination.
 * @returns {Promise<Array<number>>} Array of ticket IDs.
 */
const downloadAttachments = async function(cursor = false) {

	var liner = new lineByLine(exportFolder + 'comments.json');

	var line;
	var lineNumber = 0;
	let saved_tickets_ids = [];
	while (line = liner.next()) {
	    //console.log('Line ' + lineNumber + ': ' + line);
		if (lineNumber%2) {

			let comments = JSON.parse(line);

			for (let comment of comments) {
				if (0 < comment.attachments.length) {

					for (let attachment of comment.attachments) {
						console.log(attachment.content_url);

						const fileName = exportFolder + 'attachments/' + attachment.id + path.extname(attachment.file_name);
						// if file already exists - skipping it
						if (fs.existsSync(fileName)) {
							continue;
						}

						var config = {
							method: 'GET',
							url: attachment.content_url,
							headers: headers,
							responseType: 'arraybuffer',
						};
						try {
							let response = await axios.get(attachment.content_url, config);

							//console.log(response.data);
	
							fs.writeFileSync(fileName, Buffer.from(response.data), { flag: "w+" }, (err) => {
								if (err) throw err;
								//console.log('The file is created');
							});
						} catch (e) {
							console.log('error, skipping attachment id', attachment.id, 'Error', e.code, e.response.status);
							logError(`Skipping attachment id ${attachment.id} Error: ${e.code} ${e.response.status}`);
						}


/*

						await requestWithRateLimit(config).then(function (response) {

console.log('writing file');
							fs.writeFileSync(attachment.id, response.data + "\n", { flag: "a+" }, (err) => {
								if (err) throw err;
								//console.log('The file is created');
							});

						}).catch(function (error) {  console.log(error);});
*/
						//process.exit();
					}

				}
			}

			//console.log(''+  line);
			saved_tickets_ids.push(parseInt(line));
		}
	    lineNumber++;
	}

	console.log('getAllSavedTicketComments', saved_tickets_ids);
	return saved_tickets_ids;
}


/**
 * Retrieves views
 * @async
 * @param {boolean} next_page - Flag indicating whether there's a next page of views.
 * @param {Array} items - Array to store views.
 * @returns {Promise<void>} A Promise indicating the success of the operation.
 */
const getViews = async function(next_page = false, items = []) {

	return new Promise((resolve, reject) => {

		console.log('getViews');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'views/',
			headers: headers,
		    params: {
		    },
		};

		requestWithRateLimit.axios(config).then(async function (response) {

			items = [...items, ...response.data.views];

			if (null !== response.data.next_page) { // has more than one page
				console.log('error response.data.next_page:', response.data.next_page);

				await getViews(response.data.next_page, items);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'views.json', JSON.stringify(items) + "\n", { flag: "w+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			console.log('!!!!', error.code);
			console.log(error);

			resolve(); // if 500 error or something just skipping and continuing
		});

	});
}


/**
 * Retrieves triggers
 * @async
 * @param {boolean} next_page - Next page of triggers.
 * @param {Array} items - Array to store triggers.
 * @returns {Promise<void>} Promise indicating success of operation.
 */
const getTriggers = async function(next_page = false, items = []) {

	return new Promise((resolve, reject) => {

		console.log('getTriggers');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'triggers/',
			headers: headers,
		    params: {
		    },
		};

		requestWithRateLimit(config).then(async function (response) {

			items = [...items, ...response.data.triggers];

			if (null !== response.data.next_page) { // has more than one page
				console.log('error response.data.next_page:', response.data.next_page);

				await getTriggers(response.data.next_page, items);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'triggers.json', JSON.stringify(items) + "\n", { flag: "w+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			console.log('!!!!', error.code);
			console.log(error);

			resolve(); // if 500 error or something just skipping and continuing
		});

	});
}


/**
 * Retrieves macros from the Zendesk API.
 * @async
 * @param {boolean} next_page - Flag indicating whether there's a next page of macros.
 * @param {Array} items - Array to store macros.
 * @returns {Promise<void>} A Promise indicating the success of the operation.
 */
const getMacros = async function(next_page = false, items = []) {

	return new Promise((resolve, reject) => {

		console.log('getMacros');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'macros/',
			headers: headers,
		    params: {
		    },
		};

		requestWithRateLimit(config).then(async function (response) {

			items = [...items, ...response.data.macros];

			if (null !== response.data.next_page) { // has more than one page
				console.log('error response.data.next_page:', response.data.next_page);

				await getMacros(response.data.next_page, items);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'macros.json', JSON.stringify(items) + "\n", { flag: "w+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			console.log('!!!!', error.code);
			console.log(error);

			resolve(); // if 500 error or something just skipping and continuing
		});

	});
}


/**
 * Retrieves automations
 * @async
 * @param {boolean} next_page - Next page of automations.
 * @param {Array} items - Array to store automations.
 * @returns {Promise<void>} Promise indicating success of operation.
 */
const getAutomations = async function(next_page = false, items = []) {

	return new Promise((resolve, reject) => {

		console.log('getAutomations');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'automations/',
			headers: headers,
		    params: {
		    },
		};

		requestWithRateLimit(config).then(async function (response) {

			items = [...items, ...response.data.automations];

			if (null !== response.data.next_page) { // has more than one page
				console.log('error response.data.next_page:', response.data.next_page);

				await getAutomations(response.data.next_page, items);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'automations.json', JSON.stringify(items) + "\n", { flag: "w+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			console.log('!!!!', error.code);
			console.log(error);

			resolve(); // if 500 error or something just skipping and continuing
		});

	});
}


/**
 * Retrieves settings
 * @param {boolean} cursor - Cursor for pagination.
 * @returns {Promise<void>} Promise indicating success of operation.
 */
const getSettings = function(cursor = false) {

	var config = {
		method: 'GET',
		url: process.env.ZENDESK_API + 'account/settings.json',
		headers: headers,
	};
	requestWithRateLimit(config).then(function (response) {

		//console.log(JSON.stringify(response.data.tickets));

		fs.writeFileSync(exportFolder + 'settings.json', JSON.stringify(response.data.settings) + "\n", { flag: "w+" }, (err) => {
			if (err) throw err;
			//console.log('The file is created');
		});

		//if (cursor) { console.log('stop!'); return false; }

	}).catch(function (error) {  console.log(error);});
}

const getSupportAddresses = async function(next_page = false, items = []) {

	return new Promise((resolve, reject) => {

		console.log('getSupportAddresses');

		var config = {
			method: 'GET',
			url: (next_page) ? next_page : process.env.ZENDESK_API + 'recipient_addresses/',
			headers: headers,
		    params: {
		    },
		};

		requestWithRateLimit(config).then(async function (response) {

			items = [...items, ...response.data.recipient_addresses];

			if (null !== response.data.next_page) { // has more than one page
				console.log('error response.data.next_page:', response.data.next_page);

				await getSupportAddresses(response.data.next_page, items);

				//process.exit();
			} else {

				//console.log(JSON.stringify(response.data.comments));
				fs.writeFileSync(exportFolder + 'recipient_addresses.json', JSON.stringify(items) + "\n", { flag: "w+" }, (err) => {
					if (err) throw err;
					//console.log('The file is created');
				});
			}

			resolve();

		}).catch(function (error) {
			console.log('!!!!', error.code);
			console.log(error);

			resolve(); // if 500 error or something just skipping and continuing
		});

	});
}

// https://makedreamprofits.zendesk.com//api/v2/tags.json



const exportAll = async () => {


	console.log('Exporting tickets...');
	await getTickets();

	console.log('Exporting tickets\' comments...');
	await getAllTicketComments();


	console.log('Exporting users...');
	await getUsers();

	console.log('Downloading attachments...');
	await downloadAttachments();

	console.log('Exporting views...');
	await getViews();

	console.log('Exporting triggers...');
	await getTriggers();

	console.log('Exporting macros...');
	await getMacros();

	console.log('Exporting automations...');
	await getAutomations();

	console.log('Exporting settings...');
	await getSettings();

	console.log('Exporting support addresses...');
	await getSupportAddresses();


	console.log('Finished');
}





(async () => {
	await exportAll();

	//await getTickets();

	//await getTicketComments(17551);

	//await getAllSavedTicketComments();

	//await getAllTicketComments();

	//await getUsers();

	//await downloadAttachments();

	//await getViews();
	//await getTriggers();

	//await getMacros();

	//await getAutomations();

	//await getSettings();

	//await getSupportAddresses();

})();





