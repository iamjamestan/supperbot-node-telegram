const queries = require('../db/queries');
const sprintf = require("sprintf-js").sprintf;
const messenger = require('../messenger');

module.exports.init = async function (msg) {
    //TODO: only allow group admin or jio starter to close
    try {
        if(!await queries.checkHasJio(msg.chat.id)){
            return;
        }
        const menu = await queries.getMenu({
            chat_id: msg.chat.id,
        });

        const deliveryFee = await queries.getFee({
            menu: menu,
        });

        // get all jio orders
        const compiledOrders = await queries.getOrderOverview({
            menu: menu,
            chat_id: msg.chat.id,
        });

        // get individual user orders
        const userOrders = await queries.getChatOrders({
            menu: menu,
            chat_id: msg.chat.id,
        });

        // notify the chat
        const text = createOverviewMessage(compiledOrders, userOrders, deliveryFee);
        await messenger.send(msg.chat.id, text, {});

        // destroy jio
        await queries.destroyJio({
            chat_id: msg.chat.id,
        }); //should we await here?

        // notify users
        notifyUserOrders(msg, userOrders, deliveryFee);
    } catch (err) {
        console.log(err);
    }
}

const createOverviewMessage = function (compiledOrders, userOrders, deliveryFee) {
    let result = 'Jio closed!\n'
    if(compiledOrders.length === 0){
        return result + 'There are no items in this jio.';
    }
    result += 'The compiled list of ordered items is: \n';
    let total = 0;
    let users = {};

    // compile jio orders
    for (let i = 0; i < compiledOrders.length; i++) {
        let order = compiledOrders[i];
        let remarks = order.remarks == null ? '' : sprintf(' (%s)', order.remarks);
        let modifiers = order.mods == null ? '' : sprintf(' (%s)', order.mods);
        // insert all items into message
        result += sprintf('%s%s%s x %d\n', order.item, modifiers, remarks, order.count);
        total += order.price;
    }

    // compile individual prices
    for (let i = 0; i < userOrders.length; i++) {
        let order = userOrders[i];
        if (!users.hasOwnProperty(order.user_id)) {
            users[order.user_id] = [order.user, 0];
        }
        users[order.user_id][1] += order.price;
    }

    // Insert all user prices
    result += '\nEach person please pay:\n';
    for (const [, info] of Object.entries(users)) {
        let userDelivery = deliveryFee * info[1] / total;
        result += sprintf('%s - $%.2f(+%.2f)\n', info[0], info[1] / 100.0, userDelivery / 100.0);
    }

    // add overview
    result += sprintf('\nTotal cost: $%.2f(+%.2f)', total / 100.0, deliveryFee / 100.0);
    return result;
}

const notifyUserOrders = function (msg, userOrders, deliveryFee) {
    try{
        let totalPrice = 0;
        let users = {};

        // group all user orders
        for (let i = 0; i < userOrders.length; i++) {
            let order = userOrders[i];
            // init user if not present
            if (!users.hasOwnProperty(order.user_id)) {
                users[order.user_id] = {total: 0, items: []};
            }
            // append items
            totalPrice += order.price;
            users[order.user_id].total += order.price;
            users[order.user_id].items.push([order.item, order.count, order.remarks, order.mods]);
        }
        // notify each user
        for (const [user_id, info] of Object.entries(users)) {
            notifyUser(user_id, info.items, info.total, deliveryFee * info.total / totalPrice);
        }
    } catch (e){
        console.log(e);
    }
}

const notifyUser = function (user_id, orders, total, delivery) {
    let text = sprintf('Your share will be $%.2f (+%.2f delivery) for:\n', total / 100.0, delivery / 100.0);
    // add all of the user's items
    for (let i = 0; i < orders.length; i++) {
        let order = orders[i];
        let remarks = order[2] == null ? '' : sprintf(' (%s)', order[2]);
        let modifiers = order[3] == null ? '' : sprintf(' (%s)', order[3]);
        text += sprintf('%s%s%s x %d\n', order[0], modifiers, remarks, order[1]);
    }
    messenger.send(user_id, text, {});
}

