
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// GET TOP 3 MEMBERS
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('members')
            .select('name, points, avatar_url')
            .order('points', { ascending: false })
            .limit(3);

        if (error) throw error;

        const members = data.map(member => ({
            name: member.name,
            points: member.points,
            avatarUrl: member.avatar_url
        }));

        res.json({ members });

    } catch (error) {
        console.error('Leaderboard error:', error.message);
        res.status(500).json({
            error: 'Could not load leaderboard'
        });
    }
});

// SAVE REPORTS
app.post('/api/reports', async (req, res) => {
    try {
        const { name, type, message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                error: 'Message is required'
            });
        }

        const { error } = await supabase
            .from('reports')
            .insert([{
                name: (name || '').trim(),
                type: type || 'other',
                message: message.trim()
            }]);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Report saved successfully'
        });

    } catch (error) {
        console.error('Report error:', error.message);
        res.status(500).json({
            error: 'Could not save report'
        });
    }
});

// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`MY COMMUNITY server running on port ${PORT}`);
});
