exports.handler = async () => {
    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            { source_name: 'vidsrc.me', is_active: true },
            { source_name: 'vidsrc.xyz', is_active: true }
        ])
    };
};
